/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * device.ts: homebridge-resideo.
 */
import type { ResideoPlatform } from '../platform.js';
import type { API, HAP, Logging, PlatformAccessory } from 'homebridge';
import type { ResideoPlatformConfig, resideoDevice, location, devicesConfig } from '../settings.js';

export abstract class deviceBase {
  public readonly api: API;
  public readonly log: Logging;
  public readonly config!: ResideoPlatformConfig;
  protected readonly hap: HAP;

  // Config
  protected deviceLogging!: string;
  protected deviceUpdateRate!: number;
  protected deviceRefreshRate!: number;
  protected deviceMaxRetries!: number;
  protected deviceDelayBetweenRetries!: number;

  constructor(
    protected readonly platform: ResideoPlatform,
    protected accessory: PlatformAccessory,
    protected location: location,
    protected device: resideoDevice & devicesConfig,
  ) {
    this.api = this.platform.api;
    this.log = this.platform.log;
    this.config = this.platform.config;
    this.hap = this.api.hap;


    this.getDeviceLogSettings(device);
    this.getDeviceRefreshRateSettings(device);
    this.getDeviceRetry(device);
    this.getDeviceConfigSettings(device);
    this.getDeviceContext(accessory, device);

    // Set accessory information
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'Resideo')
      .setCharacteristic(this.hap.Characteristic.Name, accessory.displayName)
      .setCharacteristic(this.hap.Characteristic.ConfiguredName, accessory.displayName)
      .setCharacteristic(this.hap.Characteristic.Model, accessory.context.model)
      .setCharacteristic(this.hap.Characteristic.SerialNumber, accessory.context.deviceID);
  }

  async getDeviceLogSettings(device: resideoDevice & devicesConfig): Promise<void> {
    if (this.platform.debugMode) {
      this.deviceLogging = this.accessory.context.logging = 'debugMode';
      this.debugWarnLog(`${this.device.deviceClass}: ${this.accessory.displayName} Using Debug Mode Logging: ${this.deviceLogging}`);
    } else if (device.logging) {
      this.deviceLogging = this.accessory.context.logging = device.logging;
      this.debugWarnLog(`${this.device.deviceClass}: ${this.accessory.displayName} Using Device Config Logging: ${this.deviceLogging}`);
    } else if (this.config.options?.logging) {
      this.deviceLogging = this.accessory.context.logging = this.config.logging;
      this.debugWarnLog(`${this.device.deviceClass}: ${this.accessory.displayName} Using Platform Config Logging: ${this.deviceLogging}`);
    } else {
      this.deviceLogging = this.accessory.context.logging = 'standard';
      this.debugWarnLog(`${this.device.deviceClass}: ${this.accessory.displayName} Logging Not Set, Using: ${this.deviceLogging}`);
    }
  }

  async getDeviceRefreshRateSettings(device: resideoDevice & devicesConfig): Promise<void> {
    // refreshRate
    if (device.refreshRate) {
      this.deviceRefreshRate = this.accessory.context.refreshRate = device.refreshRate;
      this.debugLog(`${this.device.deviceClass}: ${this.accessory.displayName} Using Device Config refreshRate: ${this.deviceRefreshRate}`);
    } else if (this.config.options!.refreshRate) {
      this.deviceRefreshRate = this.accessory.context.refreshRate = this.config.options!.refreshRate;
      this.debugLog(`${this.device.deviceClass}: ${this.accessory.displayName} Using Platform Config refreshRate: ${this.deviceRefreshRate}`);
    }
    // updateRate
    if (device.updateRate) {
      this.deviceUpdateRate = device.updateRate;
      this.debugLog(`${this.device.deviceClass}: ${this.accessory.displayName} Using Device Config updateRate: ${this.deviceUpdateRate}`);
    } else {
      this.deviceUpdateRate = this.config.options!.pushRate!;
      this.debugLog(`${this.device.deviceClass}: ${this.accessory.displayName} Using Platform pushRate: ${this.deviceUpdateRate}`);
    }
  }

  async getDeviceRetry(device: resideoDevice & devicesConfig): Promise<void> {
    if (device.maxRetries) {
      this.deviceMaxRetries = device.maxRetries;
      this.debugLog(`${this.device.deviceClass}: ${this.accessory.displayName} Using Device Max Retries: ${this.deviceMaxRetries}`);
    } else {
      this.deviceMaxRetries = 5; // Maximum number of retries
      this.debugLog(`${this.device.deviceClass}: ${this.accessory.displayName} Max Retries Not Set, Using: ${this.deviceMaxRetries}`);
    }
    if (device.delayBetweenRetries) {
      this.deviceDelayBetweenRetries = device.delayBetweenRetries * 1000;
      this.debugLog(`${this.device.deviceClass}: ${this.accessory.displayName}`
        + ` Using Device Delay Between Retries: ${this.deviceDelayBetweenRetries}`);
    } else {
      this.deviceDelayBetweenRetries = 3000; // Delay between retries in milliseconds
      this.debugLog(`${this.device.deviceClass}: ${this.accessory.displayName} Delay Between Retries Not Set,`
        + ` Using: ${this.deviceDelayBetweenRetries}`);
    }
  }

  async getDeviceConfigSettings(device: resideoDevice & devicesConfig): Promise<void> {
    const deviceConfig = {};
    if (device.logging !== 'standard') {
      deviceConfig['logging'] = device.logging;
    }
    if (device.external === true) {
      deviceConfig['external'] = device.external;
    }
    if (device.refreshRate !== 0) {
      deviceConfig['refreshRate'] = device.refreshRate;
    }
    if (device.updateRate !== 0) {
      deviceConfig['updateRate'] = device.updateRate;
    }
    if (device.retry === true) {
      deviceConfig['retry'] = device.retry;
    }
    if (device.maxRetries !== 0) {
      deviceConfig['maxRetries'] = device.maxRetries;
    }
    if (device.delayBetweenRetries !== 0) {
      deviceConfig['delayBetweenRetries'] = device.delayBetweenRetries;
    }
    let thermostatConfig = {};
    if (device.thermostat) {
      thermostatConfig = device.thermostat;
    }
    let leaksensorConfig = {};
    if (device.leaksensor) {
      leaksensorConfig = device.leaksensor;
    }
    let valveConfig = {};
    if (device.valve) {
      valveConfig = device.valve;
    }
    const config = Object.assign({}, deviceConfig, thermostatConfig, leaksensorConfig, valveConfig);
    if (Object.entries(config).length !== 0) {
      this.debugSuccessLog(`${this.device.deviceClass}: ${this.accessory.displayName} Config: ${JSON.stringify(config)}`);
    }
  }

  async getDeviceContext(accessory: PlatformAccessory, device: resideoDevice & devicesConfig): Promise<void> {
    accessory.context.name = device.userDefinedDeviceName ? device.userDefinedDeviceName : device.name;
    accessory.context.model = device.deviceClass ? device.deviceClass : device.deviceModel;
    accessory.context.deviceId = device.deviceID;
    accessory.context.deviceType = device.deviceType;

    if (device.firmware) {
      accessory.context.version = device.firmware;
    } else if (device.firmware === undefined && device.firmwareVersion === undefined && device.thermostatVersion === undefined) {
      accessory.context.version = this.platform.version;
    } else {
      accessory.context.version = device.firmwareVersion ? device.firmwareVersion : device.thermostatVersion;
    }
    this.debugLog(`${this.device.deviceClass}: ${this.accessory.displayName} Firmware Version: ${accessory.context.version}`);
    if (accessory.context.version) {
      this.accessory
        .getService(this.hap.Service.AccessoryInformation)!
        .setCharacteristic(this.hap.Characteristic.HardwareRevision, accessory.context.version)
        .setCharacteristic(this.hap.Characteristic.FirmwareRevision, accessory.context.version)
        .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
        .updateValue(this.accessory.context.version);
    }
    this.debugSuccessLog(`${this.device.deviceClass}: ${this.accessory.displayName} Context: ${JSON.stringify(accessory.context)}`);
  }

  async statusCode(statusCode: number, action: string): Promise<void> {
    switch (statusCode) {
      case 200:
        this.log.debug(`${this.device.deviceClass}: ${this.accessory.displayName} Standard Response, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 400:
        this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} Bad Request, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 401:
        this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} Unauthorized, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 403:
        this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} Forbidden,	The request has been authenticated but does not `
          + `have appropriate permissions, or a requested resource is not found, statusCode: ${statusCode}`);
        break;
      case 404:
        this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} Not Found, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 429:
        this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} Too Many Requests, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 500:
        this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} Internal Server Error (Meater Server), statusCode: ${statusCode}, `
          + `Action: ${action}`);
        break;
      default:
        this.log.info(`${this.device.deviceClass}: ${this.accessory.displayName} Unknown statusCode: ${statusCode}, `
          + `Action: ${action}, Report Bugs Here: https://bit.ly/homebridge-resideo-bug-report`);
    }
  }


  async resideoAPIError(e: any, action: string): Promise<void> {
    if (e.message.includes('400')) {
      this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Bad Request`);
      this.log.debug('The client has issued an invalid request. This is commonly used to specify validation errors in a request payload.');
    } else if (e.message.includes('401')) {
      this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Unauthorized Request`);
      this.log.debug('Authorization for the API is required, but the request has not been authenticated.');
    } else if (e.message.includes('403')) {
      this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Forbidden Request`);
      this.log.debug('The request has been authenticated but does not have appropriate permissions, or a requested resource is not found.');
    } else if (e.message.includes('404')) {
      this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Requst Not Found`);
      this.log.debug('Specifies the requested path does not exist.');
    } else if (e.message.includes('406')) {
      this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Request Not Acceptable`);
      this.log.debug('The client has requested a MIME type via the Accept header for a value not supported by the server.');
    } else if (e.message.includes('415')) {
      this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Unsupported Requst Header`);
      this.log.debug('The client has defined a contentType header that is not supported by the server.');
    } else if (e.message.includes('422')) {
      this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Unprocessable Entity`);
      this.log.debug(
        'The client has made a valid request, but the server cannot process it.' +
        ' This is often used for APIs for which certain limits have been exceeded.');
    } else if (e.message.includes('429')) {
      this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Too Many Requests`);
      this.log.debug('The client has exceeded the number of requests allowed for a given time window.');
    } else if (e.message.includes('500')) {
      this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Internal Server Error`);
      this.log.debug('An unexpected error on the SmartThings servers has occurred. These errors should be rare.');
    } else {
      this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action},`);
    }
    if (this.deviceLogging.includes('debug')) {
      this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} failed to pushChanges, Error Message: ${JSON.stringify(e.message)}`);
    }
  }

  /**
   * Logging for Device
   */
  infoLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.log.info(String(...log));
    }
  }

  successLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.log.success(String(...log));
    }
  }

  debugSuccessLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.log.success('[DEBUG]', String(...log));
      }
    }
  }

  warnLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.log.warn(String(...log));
    }
  }

  debugWarnLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.log.warn('[DEBUG]', String(...log));
      }
    }
  }

  errorLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.log.error(String(...log));
    }
  }

  debugErrorLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.log.error('[DEBUG]', String(...log));
      }
    }
  }

  debugLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging === 'debug') {
        this.log.info('[DEBUG]', String(...log));
      } else {
        this.log.debug(String(...log));
      }
    }
  }

  enablingDeviceLogging(): boolean {
    return this.deviceLogging.includes('debug') || this.deviceLogging === 'standard';
  }
}