/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * valve.ts: homebridge-resideo.
 */
import { request } from 'undici';
import { interval, Subject } from 'rxjs';
import { debounceTime, skipWhile, take, tap } from 'rxjs/operators';
import { ResideoPlatform } from '../platform.js';
import { API, HAP, CharacteristicValue, PlatformAccessory, Service, Logging } from 'homebridge';
import { devicesConfig, DeviceURL, location, resideoDevice, payload, ResideoPlatformConfig } from '../settings.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class Valve {
  public readonly api: API;
  public readonly log: Logging;
  public readonly config!: ResideoPlatformConfig;
  protected readonly hap: HAP;
  // Services
  service: Service;

  // CharacteristicValue
  Active!: CharacteristicValue;
  InUse!: CharacteristicValue;
  ValveType!: CharacteristicValue;

  // Others
  action!: string;
  isAlive!: boolean;
  valveStatus!: string;

  // Config
  deviceLogging!: string;
  deviceRefreshRate!: number;
  valvetype!: number;

  // Updates
  valveUpdateInProgress!: boolean;
  doValveUpdate!: Subject<void>;

  constructor(
    private readonly platform: ResideoPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly locationId: location['locationID'],
    public device: resideoDevice & devicesConfig,
  ) {
    this.api = this.platform.api;
    this.log = this.platform.log;
    this.config = this.platform.config;
    this.hap = this.api.hap;

    this.Active = accessory.context.StatusActive || this.hap.Characteristic.Active.ACTIVE;
    this.InUse = accessory.context.StatusInUse || this.hap.Characteristic.InUse.NOT_IN_USE;
    if (accessory.context.ValveType === undefined) {
      switch (device.valve?.valveType) {
        case 1:
          this.valvetype = this.hap.Characteristic.ValveType.IRRIGATION;
          break;
        case 2:
          this.valvetype = this.hap.Characteristic.ValveType.SHOWER_HEAD;
          break;
        case 3:
          this.valvetype = this.hap.Characteristic.ValveType.WATER_FAUCET;
          break;
        default:
          this.valvetype = this.hap.Characteristic.ValveType.GENERIC_VALVE;
      }
    } else {
      this.valvetype = accessory.context.ValveType;
    }
    accessory.context.FirmwareRevision = 'v2.0.0';

    this.deviceLogging = this.device.logging || this.config.options?.logging || 'standard';

    // this is subject we use to track when we need to POST changes to the Resideo API
    this.doValveUpdate = new Subject();
    this.valveUpdateInProgress = false;

    // set accessory information
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'Resideo')
      .setCharacteristic(this.hap.Characteristic.Model, device.deviceType)
      .setCharacteristic(this.hap.Characteristic.SerialNumber, device.deviceID)
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, accessory.context.firmwareRevision || 'v2.0.0');

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    (this.service = this.accessory.getService(this.hap.Service.Valve)
      || this.accessory.addService(this.hap.Service.Valve)), `${accessory.displayName}`;

    // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.hap.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.hap.Characteristic.Name, accessory.displayName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/

    // Do initial device parse
    this.parseStatus();

    // create handlers for required characteristics
    this.service.getCharacteristic(this.hap.Characteristic.Active).onSet(this.setActive.bind(this));

    this.service.getCharacteristic(this.hap.Characteristic.InUse)
      .onGet(() => {
        return this.InUse!;
      });

    // Set Valve Type
    this.service.setCharacteristic(this.hap.Characteristic.ValveType, this.valvetype);

    // Retrieve initial values and updateHomekit
    this.updateHomeKitCharacteristics();

    // Start an update interval
    interval(this.config.options!.refreshRate! * 1000)
      .pipe(skipWhile(() => this.valveUpdateInProgress))
      .subscribe(async () => {
        await this.refreshStatus();
      });

    // Watch for Lock change events
    // We put in a debounce of 100ms so we don't make duplicate calls
    this.doValveUpdate
      .pipe(
        tap(() => {
          this.valveUpdateInProgress = true;
        }),
        debounceTime(this.config.options!.pushRate! * 1000),
      )
      .subscribe(async () => {
        try {
          await this.pushChanges();
        } catch (e: any) {
          this.log.error(`doValveUpdate pushChanges: ${JSON.stringify(e)}`);
        }
        // Refresh the status from the API
        interval(this.deviceRefreshRate * 500)
          .pipe(skipWhile(() => this.valveUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.refreshStatus();
          });
        this.valveUpdateInProgress = false;
      });
  }

  /**
   * Parse the device status from the Resideo api
   */
  async parseStatus(): Promise<void> {
    // Active
    if (this.isAlive) {
      this.Active = this.hap.Characteristic.Active.ACTIVE;
    } else {
      this.Active = this.hap.Characteristic.Active.INACTIVE;
    }

    // InUse
    if (this.valveStatus === 'Open') {
      this.InUse = this.hap.Characteristic.InUse.IN_USE;
    } else {
      this.InUse = this.hap.Characteristic.InUse.NOT_IN_USE;
    }
  }

  /**
   * Asks the Resideo Home API for the latest device information
   */
  async refreshStatus(): Promise<void> {
    try {
      const { body, statusCode } = await request(`${DeviceURL}/shutoffvalve/${this.device.deviceID}`, {
        method: 'GET',
        query: {
          'locationId': this.locationId,
          'apikey': this.config.credentials?.consumerKey,
        },
        headers: {
          'Authorization': `Bearer ${this.config.credentials?.accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      const action = 'refreshStatus';
      await this.statusCode(statusCode, action);
      const device: any = await body.json();
      this.log.debug(`(refreshStatus) ${device.deviceClass}: ${JSON.stringify(device)}`);
      this.device = device;
      this.isAlive = device.isAlive;
      this.valveStatus = device.actuatorValve.valveStatus;
      this.log.debug(`Valve: ${this.accessory.displayName} device: ${JSON.stringify(this.device)}`);
      this.parseStatus();
      this.updateHomeKitCharacteristics();
    } catch (e: any) {
      this.action = 'refreshStatus';
      this.resideoAPIError(e);
      this.apiError(e);
    }
  }

  /**
   * Pushes the requested changes to the August API
   */
  async pushChanges(): Promise<void> {
    try {
      const payload = {} as payload;
      if (this.Active === this.hap.Characteristic.Active.ACTIVE) {
        payload.state = 'open';
      } else {
        payload.state = 'closed';
      }
      const { statusCode } = await request(`${DeviceURL}/thermostats/${this.device.deviceID}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        query: {
          'locationId': this.locationId,
          'apikey': this.config.credentials?.consumerKey,
        },
        headers: {
          'Authorization': `Bearer ${this.config.credentials?.accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      const action = 'pushChanges';
      await this.statusCode(statusCode, action);
      this.log.debug(`Thermostat: ${this.accessory.displayName} pushChanges: ${JSON.stringify(payload)}`);
    } catch (e: any) {
      this.log.error(`pushChanges: ${JSON.stringify(e)}`);
      this.log.error(`Lock: ${this.accessory.displayName} failed pushChanges, Error Message: ${JSON.stringify(e.message)}`);
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    if (this.Active === undefined) {
      this.log.debug(`Valve: ${this.accessory.displayName} Active: ${this.Active}`);
    } else {
      this.service.updateCharacteristic(this.hap.Characteristic.Active, this.Active);
      this.log.debug(`Valve: ${this.accessory.displayName} updateCharacteristic Active: ${this.Active}`);
    }
    if (this.InUse === undefined) {
      this.log.debug(`Valve: ${this.accessory.displayName} InUse: ${this.InUse}`);
    } else {
      this.service.updateCharacteristic(this.hap.Characteristic.InUse, this.InUse);
      this.log.debug(`Valve: ${this.accessory.displayName} updateCharacteristic InUse: ${this.InUse}`);
    }
  }

  /**
   * Handle requests to set the "Active" characteristic
   */
  setActive(value) {
    this.log.debug(`Thermostat: ${this.accessory.displayName} Set Active: ${value}`);
    this.Active = value;
    this.doValveUpdate.next();
  }

  /**
   * Handle requests to get the current value of the "In Use" characteristic
   */
  handleInUseGet() {
    this.log.debug('Triggered GET InUse');

    // set this to a valid value for InUse
    const currentValue = this.hap.Characteristic.InUse.NOT_IN_USE;

    return currentValue;
  }

  async apiError(e: any): Promise<void> {
    this.service.updateCharacteristic(this.hap.Characteristic.Active, e);
  }

  async resideoAPIError(e: any): Promise<void> {
    if (this.device.retry) {
      if (this.action === 'refreshStatus') {
        // Refresh the status from the API
        interval(5000)
          .pipe(skipWhile(() => this.valveUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.refreshStatus();
          });
      }
    }
    if (e.message.includes('400')) {
      this.log.error(`Valve: ${this.accessory.displayName} failed to ${this.action}, Bad Request`);
      this.log.debug('The client has issued an invalid request. This is commonly used to specify validation errors in a request payload.');
    } else if (e.message.includes('401')) {
      this.log.error(`Valve: ${this.accessory.displayName} failed to ${this.action}, Unauthorized Request`);
      this.log.debug('Authorization for the API is required, but the request has not been authenticated.');
    } else if (e.message.includes('403')) {
      this.log.error(`Valve: ${this.accessory.displayName} failed to ${this.action}, Forbidden Request`);
      this.log.debug('The request has been authenticated but does not have appropriate permissions, or a requested resource is not found.');
    } else if (e.message.includes('404')) {
      this.log.error(`Valve: ${this.accessory.displayName} failed to ${this.action}, Requst Not Found`);
      this.log.debug('Specifies the requested path does not exist.');
    } else if (e.message.includes('406')) {
      this.log.error(`Valve: ${this.accessory.displayName} failed to ${this.action}, Request Not Acceptable`);
      this.log.debug('The client has requested a MIME type via the Accept header for a value not supported by the server.');
    } else if (e.message.includes('415')) {
      this.log.error(`Valve: ${this.accessory.displayName} failed to ${this.action}, Unsupported Requst Header`);
      this.log.debug('The client has defined a contentType header that is not supported by the server.');
    } else if (e.message.includes('422')) {
      this.log.error(`Valve: ${this.accessory.displayName} failed to ${this.action}, Unprocessable Entity`);
      this.log.debug(
        'The client has made a valid request, but the server cannot process it.' +
        ' This is often used for APIs for which certain limits have been exceeded.',
      );
    } else if (e.message.includes('429')) {
      this.log.error(`Valve: ${this.accessory.displayName} failed to ${this.action}, Too Many Requests`);
      this.log.debug('The client has exceeded the number of requests allowed for a given time window.');
    } else if (e.message.includes('500')) {
      this.log.error(`Valve: ${this.accessory.displayName} failed to ${this.action}, Internal Server Error`);
      this.log.debug('An unexpected error on the SmartThings servers has occurred. These errors should be rare.');
    } else {
      this.log.error(`Valve: ${this.accessory.displayName} failed to ${this.action},`);
    }
    if (this.deviceLogging.includes('debug')) {
      this.log.error(`Valve: ${this.accessory.displayName} failed to pushChanges, Error Message: ${JSON.stringify(e.message)}`);
    }
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
