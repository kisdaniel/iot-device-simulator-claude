import { Routes } from '@angular/router';
import { DeviceDetail } from './devices/device-detail';
import { DeviceForm } from './devices/device-form';
import { DeviceList } from './devices/device-list';
import { HomeAssistantPage } from './homeassistant/homeassistant-page';
import { BrokerSettings } from './settings/broker-settings';

export const routes: Routes = [
  { path: '', component: DeviceList, title: 'Eszközök – IoT szimulátor' },
  { path: 'devices/new', component: DeviceForm, title: 'Új eszköz – IoT szimulátor' },
  { path: 'devices/:id', component: DeviceDetail, title: 'Eszköz – IoT szimulátor' },
  {
    path: 'devices/:id/edit',
    component: DeviceForm,
    title: 'Eszköz szerkesztése – IoT szimulátor',
  },
  {
    path: 'homeassistant',
    component: HomeAssistantPage,
    title: 'Home Assistant – IoT szimulátor',
  },
  { path: 'settings', component: BrokerSettings, title: 'Beállítások – IoT szimulátor' },
  { path: '**', redirectTo: '' },
];
