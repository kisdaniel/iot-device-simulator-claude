import { Component, inject } from '@angular/core';
import { BrokerStatus } from './core/broker-status';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly broker = inject(BrokerStatus);
}
