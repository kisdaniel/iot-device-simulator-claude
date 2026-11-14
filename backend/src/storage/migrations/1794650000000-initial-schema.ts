import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1794650000000 implements MigrationInterface {
  name = 'InitialSchema1794650000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "settings" (
        "key" text PRIMARY KEY NOT NULL,
        "value" text NOT NULL
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "devices" (
        "id" text PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "type" text NOT NULL,
        "enabled" boolean NOT NULL DEFAULT (1),
        "config" text NOT NULL,
        "identity" text NOT NULL,
        "created_at" text NOT NULL,
        "updated_at" text NOT NULL,
        CONSTRAINT "UQ_devices_identity" UNIQUE ("identity")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "switches" (
        "device_id" text NOT NULL,
        "idx" integer NOT NULL,
        "output" boolean NOT NULL DEFAULT (0),
        "source" text NOT NULL DEFAULT ('init'),
        "load_power" real,
        "voltage" real,
        "current_override" real,
        "power_factor" real,
        "frequency" real,
        "energy_total_wh" real,
        "energy_today_wh" real,
        "energy_yesterday_wh" real,
        "energy_updated_at" text,
        PRIMARY KEY ("device_id", "idx"),
        CONSTRAINT "FK_switches_device" FOREIGN KEY ("device_id")
          REFERENCES "devices" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "temperature_sensors" (
        "device_id" text NOT NULL,
        "idx" integer NOT NULL,
        "address" text NOT NULL,
        "tc" real,
        "error" text,
        PRIMARY KEY ("device_id", "idx"),
        CONSTRAINT "FK_temperature_sensors_device" FOREIGN KEY ("device_id")
          REFERENCES "devices" ("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "temperature_sensors"`);
    await queryRunner.query(`DROP TABLE "switches"`);
    await queryRunner.query(`DROP TABLE "devices"`);
    await queryRunner.query(`DROP TABLE "settings"`);
  }
}
