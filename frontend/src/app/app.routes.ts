import { Routes } from '@angular/router';
import { DeviceList } from './devices/device-list';
import { BrokerSettings } from './settings/broker-settings';

export const routes: Routes = [
  { path: '', component: DeviceList, title: 'Eszközök – IoT szimulátor' },
  { path: 'settings', component: BrokerSettings, title: 'Beállítások – IoT szimulátor' },
  { path: '**', redirectTo: '' },
];
