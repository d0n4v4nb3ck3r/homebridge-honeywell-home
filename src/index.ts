/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * index.ts: homebridge-resideo.
 */
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { API } from 'homebridge';
import { ResideoPlatform } from './platform.js';

// Register our platform with homebridge.
export default (api: API): void => {

  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, ResideoPlatform);
};
