/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * roomsensors.ts: homebridge-resideo.
 */
import { Subject, interval } from 'rxjs';
import { take, skipWhile } from 'rxjs/operators';
import { ResideoPlatform } from '../platform.js';
import { Service, PlatformAccessory, CharacteristicValue, API, HAP, Logging } from 'homebridge';
import { devicesConfig, location, resideoDevice, ResideoPlatformConfig, sensorAccessory, T9groups } from '../settings.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class RoomSensors {
  public readonly api: API;
  public readonly log: Logging;
  public readonly config!: ResideoPlatformConfig;
  protected readonly hap: HAP;
  // Services
  service: Service;
  temperatureService?: Service;
  occupancyService?: Service;
  humidityService?: Service;

  // CharacteristicValue
  StatusLowBattery!: CharacteristicValue;
  OccupancyDetected!: CharacteristicValue;
  CurrentTemperature!: CharacteristicValue;
  CurrentRelativeHumidity!: CharacteristicValue;
  TemperatureDisplayUnits!: CharacteristicValue;

  // Others
  accessoryId!: number;
  roomId!: number;
  action!: string;

  // Config
  deviceLogging!: string;
  deviceRefreshRate!: number;

  // Updates
  SensorUpdateInProgress!: boolean;
  doSensorUpdate!: Subject<void>;

  constructor(
    private readonly platform: ResideoPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly locationId: location['locationID'],
    public device: resideoDevice & devicesConfig,
    public sensorAccessory: sensorAccessory,
    public readonly group: T9groups,
  ) {
    this.api = this.platform.api;
    this.log = this.platform.log;
    this.config = this.platform.config;
    this.hap = this.api.hap;

    this.StatusLowBattery = this.accessory.context.StatusLowBattery || this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    this.OccupancyDetected = this.accessory.context.OccupancyDetected || this.hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
    this.CurrentTemperature = this.accessory.context.CurrentTemperature || 20;
    this.CurrentRelativeHumidity = this.accessory.context.CurrentRelativeHumidity || 50;
    this.TemperatureDisplayUnits = this.accessory.context.TemperatureDisplayUnits || this.hap.Characteristic.TemperatureDisplayUnits.CELSIUS;
    this.accessoryId = sensorAccessory.accessoryId;
    this.roomId = sensorAccessory.roomId;
    accessory.context.FirmwareRevision = 'v2.0.0';

    this.deviceLogging = this.device.logging || this.config.options?.logging || 'standard';

    // this is subject we use to track when we need to POST changes to the Resideo API
    this.doSensorUpdate = new Subject();
    this.SensorUpdateInProgress = false;

    // set accessory information
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'Resideo')
      .setCharacteristic(this.hap.Characteristic.Model, sensorAccessory.accessoryAttribute.model)
      .setCharacteristic(this.hap.Characteristic.SerialNumber, sensorAccessory.deviceID)
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, accessory.context.firmwareRevision || 'v2.0.0');

    // get the BatteryService service if it exists, otherwise create a new Battery service
    // you can create multiple services for each accessory
    (this.service = this.accessory.getService(this.hap.Service.Battery) || this.accessory.addService(this.hap.Service.Battery)),
    `${accessory.displayName} Battery`;

    // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.hap.Service.Battery, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.hap.Characteristic.Name, accessory.displayName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/

    // Do initial device parse
    this.parseStatus();

    // Set Charging State
    this.service.setCharacteristic(this.hap.Characteristic.ChargingState, 2);

    // Temperature Sensor Service
    if (device.thermostat?.roomsensor?.hide_temperature) {
      this.log.debug(`Room Sensor: ${accessory.displayName} Removing Temperature Sensor Service`);
      this.temperatureService = this.accessory.getService(this.hap.Service.TemperatureSensor);
      accessory.removeService(this.temperatureService!);
    } else if (!this.temperatureService) {
      this.log.debug(`Room Sensor: ${accessory.displayName} Add Temperature Sensor Service`);
      (this.temperatureService =
        this.accessory.getService(this.hap.Service.TemperatureSensor) || this.accessory.addService(this.hap.Service.TemperatureSensor)),
      `${accessory.displayName} Temperature Sensor`;

      this.temperatureService.setCharacteristic(this.hap.Characteristic.Name, `${accessory.displayName} Temperature Sensor`);

      this.temperatureService
        .getCharacteristic(this.hap.Characteristic.CurrentTemperature)
        .setProps({
          minValue: -273.15,
          maxValue: 100,
          minStep: 0.1,
        })
        .onGet(() => {
          return this.CurrentTemperature;
        });
    } else {
      this.log.debug(`Room Sensor: ${accessory.displayName} Temperature Sensor Service Not Added`);
    }

    // Occupancy Sensor Service
    if (device.thermostat?.roomsensor?.hide_occupancy) {
      this.log.debug(`Room Sensor: ${accessory.displayName} Removing Occupancy Sensor Service`);
      this.occupancyService = this.accessory.getService(this.hap.Service.OccupancySensor);
      accessory.removeService(this.occupancyService!);
    } else if (!this.occupancyService) {
      this.log.debug(`Room Sensor: ${accessory.displayName} Add Occupancy Sensor Service`);
      (this.occupancyService =
        this.accessory.getService(this.hap.Service.OccupancySensor) || this.accessory.addService(this.hap.Service.OccupancySensor)),
      `${accessory.displayName} Occupancy Sensor`;

      this.occupancyService.setCharacteristic(this.hap.Characteristic.Name, `${accessory.displayName} Occupancy Sensor`);
    } else {
      this.log.debug(`Room Sensor: ${accessory.displayName} Occupancy Sensor Service Not Added`);
    }

    // Humidity Sensor Service
    if (device.thermostat?.roomsensor?.hide_humidity) {
      this.log.debug(`Room Sensor: ${accessory.displayName} Removing Humidity Sensor Service`);
      this.humidityService = this.accessory.getService(this.hap.Service.HumiditySensor);
      accessory.removeService(this.humidityService!);
    } else if (!this.humidityService) {
      this.log.debug(`Room Sensor: ${accessory.displayName} Add Humidity Sensor Service`);
      (this.humidityService =
        this.accessory.getService(this.hap.Service.HumiditySensor) || this.accessory.addService(this.hap.Service.HumiditySensor)),
      `${accessory.displayName} Humidity Sensor`;

      this.humidityService.setCharacteristic(this.hap.Characteristic.Name, `${accessory.displayName} Humidity Sensor`);

      this.humidityService
        .getCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity)
        .setProps({
          minStep: 0.1,
        })
        .onGet(() => {
          return this.CurrentRelativeHumidity;
        });
    } else {
      this.log.debug(`Room Sensor: ${accessory.displayName} Humidity Sensor Service Not Added`);
    }

    // Retrieve initial values and updateHomekit
    this.updateHomeKitCharacteristics();

    // Start an update interval
    interval(this.config.options!.refreshRate! * 1000)
      .pipe(skipWhile(() => this.SensorUpdateInProgress))
      .subscribe(async () => {
        await this.refreshStatus();
      });
  }

  /**
   * Parse the device status from the Resideo api
   */
  async parseStatus(): Promise<void> {
    // Set Room Sensor State
    if (this.sensorAccessory.accessoryValue.batteryStatus.startsWith('Ok')) {
      this.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    } else {
      this.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    }
    this.log.debug(`Room Sensor: ${this.accessory.displayName} StatusLowBattery: ${this.StatusLowBattery}`);

    // Set Temperature Sensor State
    if (!this.device.thermostat?.roomsensor?.hide_temperature) {
      this.CurrentTemperature = this.toCelsius(this.sensorAccessory.accessoryValue.indoorTemperature);
    }
    this.log.debug(`Room Sensor: ${this.accessory.displayName} CurrentTemperature: ${this.CurrentTemperature}°c`);

    // Set Occupancy Sensor State
    if (!this.device.thermostat?.roomsensor?.hide_occupancy) {
      if (this.sensorAccessory.accessoryValue.occupancyDet) {
        this.OccupancyDetected = 1;
      } else {
        this.OccupancyDetected = 0;
      }
    }

    // Set Humidity Sensor State
    if (!this.device.thermostat?.roomsensor?.hide_humidity) {
      this.CurrentRelativeHumidity = this.sensorAccessory.accessoryValue.indoorHumidity;
    }
    this.log.debug(`Room Sensor: ${this.accessory.displayName} CurrentRelativeHumidity: ${this.CurrentRelativeHumidity}%`);
  }

  /**
   * Asks the Resideo Home API for the latest device information
   */
  async refreshStatus(): Promise<void> {
    try {
      const roomsensors = await this.platform.getCurrentSensorData(this.device, this.group, this.locationId);
      this.sensorAccessory = roomsensors[this.roomId][this.accessoryId];
      this.parseStatus();
      this.updateHomeKitCharacteristics();
    } catch (e: any) {
      this.action = 'refreshStatus';
      this.resideoAPIError(e);
      this.apiError(e);
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    if (this.StatusLowBattery === undefined) {
      this.log.debug(`Room Sensor: ${this.accessory.displayName} StatusLowBattery: ${this.StatusLowBattery}`);
    } else {
      this.service.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, this.StatusLowBattery);
      this.log.debug(`Room Sensor: ${this.accessory.displayName} updateCharacteristic StatusLowBattery: ${this.StatusLowBattery}`);
    }
    if (this.device.thermostat?.roomsensor?.hide_temperature || (this.CurrentTemperature === undefined && Number.isNaN(this.CurrentTemperature))) {
      this.log.debug(`Room Sensor: ${this.accessory.displayName} CurrentTemperature: ${this.CurrentTemperature}`);
    } else {
      this.temperatureService?.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, this.CurrentTemperature);
      this.log.debug(`Room Sensor: ${this.accessory.displayName} updateCharacteristic CurrentTemperature: ${this.CurrentTemperature}`);
    }
    if (this.device.thermostat?.roomsensor?.hide_occupancy || this.OccupancyDetected === undefined) {
      this.log.debug(`Room Sensor: ${this.accessory.displayName} OccupancyDetected: ${this.OccupancyDetected}`);
    } else {
      this.occupancyService?.updateCharacteristic(this.hap.Characteristic.OccupancyDetected, this.OccupancyDetected);
      this.log.debug(`Room Sensor: ${this.accessory.displayName} updateCharacteristic OccupancyDetected: ${this.OccupancyDetected}`);
    }
    if (this.device.thermostat?.roomsensor?.hide_humidity || this.CurrentRelativeHumidity === undefined) {
      this.log.debug(`Room Sensor: ${this.accessory.displayName} CurrentRelativeHumidity: ${this.CurrentRelativeHumidity}`);
    } else {
      this.humidityService?.updateCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity, this.CurrentRelativeHumidity);
      this.log.debug(`Room Sensor: ${this.accessory.displayName}` + ` updateCharacteristic CurrentRelativeHumidity: ${this.CurrentRelativeHumidity}`);
    }
  }

  async apiError(e: any): Promise<void> {
    this.service.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, e);
    if (!this.device.thermostat?.roomsensor?.hide_temperature) {
      this.temperatureService?.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, e);
    }
    //throw new this.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  async resideoAPIError(e: any): Promise<void> {
    if (this.device.retry) {
      if (this.action === 'refreshStatus') {
        // Refresh the status from the API
        interval(5000)
          .pipe(skipWhile(() => this.SensorUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.refreshStatus();
          });
      }
    }
    if (e.message.includes('400')) {
      this.log.error(`Room Sensor: ${this.accessory.displayName} failed to ${this.action}, Bad Request`);
      this.log.debug('The client has issued an invalid request. This is commonly used to specify validation errors in a request payload.');
    } else if (e.message.includes('401')) {
      this.log.error(`Room Sensor: ${this.accessory.displayName} failed to ${this.action}, Unauthorized Request`);
      this.log.debug('Authorization for the API is required, but the request has not been authenticated.');
    } else if (e.message.includes('403')) {
      this.log.error(`Room Sensor: ${this.accessory.displayName} failed to ${this.action}, Forbidden Request`);
      this.log.debug('The request has been authenticated but does not have appropriate permissions, or a requested resource is not found.');
    } else if (e.message.includes('404')) {
      this.log.error(`Room Sensor: ${this.accessory.displayName} failed to ${this.action}, Requst Not Found`);
      this.log.debug('Specifies the requested path does not exist.');
    } else if (e.message.includes('406')) {
      this.log.error(`Room Sensor: ${this.accessory.displayName} failed to ${this.action}, Request Not Acceptable`);
      this.log.debug('The client has requested a MIME type via the Accept header for a value not supported by the server.');
    } else if (e.message.includes('415')) {
      this.log.error(`Room Sensor: ${this.accessory.displayName} failed to ${this.action}, Unsupported Requst Header`);
      this.log.debug('The client has defined a contentType header that is not supported by the server.');
    } else if (e.message.includes('422')) {
      this.log.error(`Room Sensor: ${this.accessory.displayName} failed to ${this.action}, Unprocessable Entity`);
      this.log.debug(
        'The client has made a valid request, but the server cannot process it.' +
          ' This is often used for APIs for which certain limits have been exceeded.',
      );
    } else if (e.message.includes('429')) {
      this.log.error(`Room Sensor: ${this.accessory.displayName} failed to ${this.action}, Too Many Requests`);
      this.log.debug('The client has exceeded the number of requests allowed for a given time window.');
    } else if (e.message.includes('500')) {
      this.log.error(`Room Sensor: ${this.accessory.displayName} failed to ${this.action}, Internal Server Error`);
      this.log.debug('An unexpected error on the SmartThings servers has occurred. These errors should be rare.');
    } else {
      this.log.error(`Room Sensor: ${this.accessory.displayName} failed to ${this.action},`);
    }
    if (this.deviceLogging.includes('debug')) {
      this.log.error(`Room Sensor: ${this.accessory.displayName} failed to pushChanges, Error Message: ${JSON.stringify(e.message)}`);
    }
  }

  async statusCode(statusCode: number): Promise<void> {
    switch (statusCode) {
      case 200:
        this.log.debug(`${this.accessory.displayName} Standard Response, statusCode: ${statusCode}`);
        break;
      case 400:
        this.log.error(`${this.accessory.displayName} Bad Request, statusCode: ${statusCode}`);
        break;
      case 401:
        this.log.error(`${this.accessory.displayName} Unauthorized, statusCode: ${statusCode}`);
        break;
      case 404:
        this.log.error(`${this.accessory.displayName} Not Found, statusCode: ${statusCode}`);
        break;
      case 429:
        this.log.error(`${this.accessory.displayName} Too Many Requests, statusCode: ${statusCode}`);
        break;
      case 500:
        this.log.error(`${this.accessory.displayName} Internal Server Error (Meater Server), statusCode: ${statusCode}`);
        break;
      default:
        this.log.info(
          `${this.accessory.displayName} Unknown statusCode: ${statusCode}, Report Bugs Here: https://bit.ly/homebridge-resideo-bug-report`);
    }
  }

  /**
   * Converts the value to celsius if the temperature units are in Fahrenheit
   */
  toCelsius(value: number): number {
    if (this.TemperatureDisplayUnits === this.hap.Characteristic.TemperatureDisplayUnits.CELSIUS) {
      return value;
    }

    // celsius should be to the nearest 0.5 degree
    return Math.round((5 / 9) * (value - 32) * 2) / 2;
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
