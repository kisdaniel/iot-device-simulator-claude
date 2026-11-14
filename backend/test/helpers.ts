import { createServer, type Server, type Socket } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Aedes } from 'aedes';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

const ENV_KEYS = [
  'MQTT_URL',
  'MQTT_USERNAME',
  'MQTT_PASSWORD',
  'MQTT_CLIENT_ID',
  'DATA_DIR',
  'MESSAGE_LOG_SIZE',
];

/** Alkalmazás memóriabeli adatbázissal; a megadott változók felülírják a környezetet. */
export async function createApp(
  env: Record<string, string> = {},
): Promise<INestApplication<App>> {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, { DATA_DIR: ':memory:', ...env });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}

export interface PublishedMessage {
  topic: string;
  payload: string;
  retain: boolean;
}

/** Memóriában futó MQTT broker, amely feljegyzi a kliensek által küldött üzeneteket. */
export class TestBroker {
  readonly published: PublishedMessage[] = [];
  private aedes!: Aedes;
  private server!: Server;
  private readonly sockets = new Set<Socket>();
  port = 0;

  async start(port = 0): Promise<this> {
    this.aedes = await Aedes.createBroker();
    this.aedes.on('publish', (packet, client) => {
      if (!client) return; // a broker saját ($SYS) üzenetei
      this.published.push({
        topic: packet.topic,
        payload: packet.payload.toString(),
        retain: Boolean(packet.retain),
      });
    });
    this.server = createServer((socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      this.aedes.handle(socket);
    });
    await new Promise<void>((resolve) =>
      this.server.listen(port, '127.0.0.1', resolve),
    );
    this.port = (this.server.address() as { port: number }).port;
    return this;
  }

  get url(): string {
    return `mqtt://127.0.0.1:${this.port}`;
  }

  /** Szabályos bontás nélkül megszakít minden kapcsolatot, és leállítja a brokert. */
  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise((resolve) => this.server.close(() => resolve(undefined)));
    await new Promise((resolve) => this.aedes.close(() => resolve(undefined)));
  }

  /** Egy topicra utoljára küldött üzenet tartalma. */
  last(topic: string): string | undefined {
    return this.published.findLast((m) => m.topic === topic)?.payload;
  }

  clear(): void {
    this.published.length = 0;
  }
}

/** Megvárja, amíg a feltétel igaz lesz; időtúllépéskor a megadott leírással hibát dob. */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  description: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Időtúllépés: ${description}`);
}
