/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * device.ts: homebridge-resideo.
 */
import { API, HAP, Logging, PlatformAccessory } from 'homebridge';
import { RainbirdPlatform } from '../platform.js';
import { RainBirdService } from 'rainbird';
import { DevicesConfig, ResideoPlatformConfig } from '../settings.js';

export abstract class DeviceBase {
  public readonly api: API;
  public readonly log: Logging;
  public readonly config!: ResideoPlatformConfig;
  protected readonly hap: HAP;
  // Service

  // Config
  protected deviceLogging!: string;
  protected deviceRefreshRate!: number;

  constructor(
    protected readonly platform: RainbirdPlatform,
    protected accessory: PlatformAccessory,
    protected device: DevicesConfig,
    protected rainbird: RainBirdService,
  ) {
    this.api = this.platform.api;
    this.log = this.platform.log;
    this.config = this.platform.config;
    this.hap = this.api.hap;

    this.logs(device);
    this.refreshRate(device);

    // Set accessory information
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'RainBird')
      .setCharacteristic(this.hap.Characteristic.Model, accessory.context.model ?? rainbird!.model)
      .setCharacteristic(this.hap.Characteristic.SerialNumber, accessory.context.deviceID ?? rainbird!.serialNumber)
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, accessory.context.FirmwareRevision ?? rainbird!.version)
      .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
      .updateValue(accessory.context.FirmwareRevision);
  }

  logs(device: DevicesConfig) {
    if (this.platform.debugMode) {
      this.deviceLogging = this.accessory.context.logging = 'debugMode';
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} Using Debug Mode Logging: ${this.deviceLogging}`);
    } else if (device.logging) {
      this.deviceLogging = this.accessory.context.logging = device.logging;
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} Using Device Config Logging: ${this.deviceLogging}`);
    } else if (this.platform.config.options?.logging) {
      this.deviceLogging = this.accessory.context.logging = this.platform.config.options?.logging;
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} Using Platform Config Logging: ${this.deviceLogging}`);
    } else {
      this.deviceLogging = this.accessory.context.logging = 'standard';
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} Logging Not Set, Using: ${this.deviceLogging}`);
    }
  }

  refreshRate(device: DevicesConfig) {
    if (device.refreshRate) {
      this.deviceRefreshRate = this.accessory.context.refreshRate = device.refreshRate;
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} Using Device Config refreshRate: ${this.deviceRefreshRate}`);
    } else if (this.platform.config.options!.refreshRate) {
      this.deviceRefreshRate = this.accessory.context.refreshRate = this.platform.config.options!.refreshRate;
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} Using Platform Config refreshRate: ${this.deviceRefreshRate}`);
    }
  }

  /**
   * Logging for Device
   */
  infoLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.platform.log.info(String(...log));
    }
  }

  warnLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.platform.log.warn(String(...log));
    }
  }

  debugWarnLog({ log = [] }: { log?: any[]; } = {}): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.platform.log.warn('[DEBUG]', String(...log));
      }
    }
  }

  errorLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.platform.log.error(String(...log));
    }
  }

  debugErrorLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.platform.log.error('[DEBUG]', String(...log));
      }
    }
  }

  debugLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging === 'debug') {
        this.platform.log.info('[DEBUG]', String(...log));
      } else {
        this.platform.log.debug(String(...log));
      }
    }
  }

  enablingDeviceLogging(): boolean {
    return this.deviceLogging.includes('debug') || this.deviceLogging === 'standard';
  }
}