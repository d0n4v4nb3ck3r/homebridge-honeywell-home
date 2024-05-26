/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * roomsensors.ts: homebridge-resideo.
 */
import { toCelsius } from '../utils.js';
import { Subject, interval } from 'rxjs';
import { deviceBase } from './device.js';
import { take, skipWhile } from 'rxjs/operators';

import type { ResideoPlatform } from '../platform.js';
import type { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import type { devicesConfig, location, resideoDevice, sensorAccessory, T9groups } from '../settings.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class RoomSensors extends deviceBase {
  // Services
  private Battery: {
    Service: Service;
    BatteryLevel: CharacteristicValue;
    ChargingState: CharacteristicValue;
    StatusLowBattery: CharacteristicValue;
  };

  private OccupancySensor?: {
    Service: Service;
    OccupancyDetected: CharacteristicValue;
  };

  private HumiditySensor?: {
    Service: Service;
    CurrentRelativeHumidity: CharacteristicValue;
  };

  private TemperatureSensor?: {
    Service: Service;
    CurrentTemperature: CharacteristicValue;
  };

  TemperatureDisplayUnits!: CharacteristicValue;

  // Others
  accessoryId!: number;
  roomId!: number;

  // Updates
  SensorUpdateInProgress!: boolean;
  doSensorUpdate!: Subject<void>;

  constructor(
    readonly platform: ResideoPlatform,
    accessory: PlatformAccessory,
    location: location,
    device: resideoDevice & devicesConfig,
    public sensorAccessory: sensorAccessory,
    public readonly group: T9groups,
  ) {
    super(platform, accessory, location, device);

    this.accessoryId = sensorAccessory.accessoryId;
    this.roomId = sensorAccessory.roomId;

    // this is subject we use to track when we need to POST changes to the Resideo API
    this.doSensorUpdate = new Subject();
    this.SensorUpdateInProgress = false;

    // Initialize Valve property
    this.Battery = {
      Service: accessory.getService(this.hap.Service.Battery) as Service,
      BatteryLevel: accessory.context.BatteryLevel || 100,
      ChargingState: accessory.context.ChargingState || this.hap.Characteristic.ChargingState.NOT_CHARGEABLE,
      StatusLowBattery: accessory.context.StatusLowBattery || this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
    };

    // Initialize LeakSensor property
    if (!device.thermostat?.roomsensor?.hide_occupancy) {
      this.OccupancySensor = {
        Service: accessory.getService(this.hap.Service.LeakSensor) as Service,
        OccupancyDetected: accessory.context.OccupancyDetected || this.hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
      };
    }

    // Initialize TemperatureSensor property
    if (!device.thermostat?.roomsensor?.hide_temperature) {
      this.TemperatureSensor = {
        Service: accessory.getService(this.hap.Service.TemperatureSensor) as Service,
        CurrentTemperature: accessory.context.CurrentTemperature || 20,
      };
    }

    // Initialize HumiditySensor property
    if (!device.thermostat?.roomsensor?.hide_humidity) {
      this.HumiditySensor = {
        Service: accessory.getService(this.hap.Service.HumiditySensor) as Service,
        CurrentRelativeHumidity: accessory.context.CurrentRelativeHumidity || 50,
      };
    }

    // Intial Refresh
    this.refreshStatus();


    // get the BatteryService service if it exists, otherwise create a new Battery service
    // you can create multiple services for each accessory
    (this.Battery.Service = this.accessory.getService(this.hap.Service.Battery)
      || this.accessory.addService(this.hap.Service.Battery)), `${accessory.displayName} Battery`;

    // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.hap.Service.Battery, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.Battery.Service.setCharacteristic(this.hap.Characteristic.Name, accessory.displayName);

    // Set Charging State
    this.Battery.Service.setCharacteristic(this.hap.Characteristic.ChargingState, this.hap.Characteristic.ChargingState.NOT_CHARGEABLE);

    // Temperature Sensor Service
    if (device.thermostat?.roomsensor?.hide_temperature) {
      this.debugLog(`Room Sensor: ${accessory.displayName} Removing Temperature Sensor Service`);
      this.TemperatureSensor!.Service = this.accessory.getService(this.hap.Service.TemperatureSensor) as Service;
      accessory.removeService(this.TemperatureSensor!.Service);
    } else if (!this.TemperatureSensor?.Service) {
      this.debugLog(`Room Sensor: ${accessory.displayName} Add Temperature Sensor Service`);
      (this.TemperatureSensor!.Service =
        this.accessory.getService(this.hap.Service.TemperatureSensor)
        || this.accessory.addService(this.hap.Service.TemperatureSensor)), `${accessory.displayName} Temperature Sensor`;

      this.TemperatureSensor!.Service.setCharacteristic(this.hap.Characteristic.Name, `${accessory.displayName} Temperature Sensor`);

      this.TemperatureSensor!.Service
        .getCharacteristic(this.hap.Characteristic.CurrentTemperature)
        .setProps({
          minValue: -273.15,
          maxValue: 100,
          minStep: 0.1,
        })
        .onGet(() => {
          return this.TemperatureSensor!.CurrentTemperature;
        });
    } else {
      this.debugLog(`Room Sensor: ${accessory.displayName} Temperature Sensor Service Not Added`);
    }

    // Occupancy Sensor Service
    if (device.thermostat?.roomsensor?.hide_occupancy) {
      this.debugLog(`Room Sensor: ${accessory.displayName} Removing Occupancy Sensor Service`);
      this.OccupancySensor!.Service = this.accessory.getService(this.hap.Service.OccupancySensor) as Service;
      accessory.removeService(this.OccupancySensor!.Service);
    } else if (!this.OccupancySensor?.Service) {
      this.debugLog(`Room Sensor: ${accessory.displayName} Add Occupancy Sensor Service`);
      (this.OccupancySensor!.Service =
        this.accessory.getService(this.hap.Service.OccupancySensor)
        || this.accessory.addService(this.hap.Service.OccupancySensor)), `${accessory.displayName} Occupancy Sensor`;

      this.OccupancySensor!.Service.setCharacteristic(this.hap.Characteristic.Name, `${accessory.displayName} Occupancy Sensor`);
    } else {
      this.debugLog(`Room Sensor: ${accessory.displayName} Occupancy Sensor Service Not Added`);
    }

    // Humidity Sensor Service
    if (device.thermostat?.roomsensor?.hide_humidity) {
      this.debugLog(`Room Sensor: ${accessory.displayName} Removing Humidity Sensor Service`);
      this.HumiditySensor!.Service = this.accessory.getService(this.hap.Service.HumiditySensor) as Service;
      accessory.removeService(this.HumiditySensor!.Service);
    } else if (!this.HumiditySensor?.Service) {
      this.debugLog(`Room Sensor: ${accessory.displayName} Add Humidity Sensor Service`);
      (this.HumiditySensor!.Service =
        this.accessory.getService(this.hap.Service.HumiditySensor)
        || this.accessory.addService(this.hap.Service.HumiditySensor)), `${accessory.displayName} Humidity Sensor`;

      this.HumiditySensor!.Service.setCharacteristic(this.hap.Characteristic.Name, `${accessory.displayName} Humidity Sensor`);

      this.HumiditySensor!.Service
        .getCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity)
        .setProps({
          minStep: 0.1,
        })
        .onGet(() => {
          return this.HumiditySensor!.CurrentRelativeHumidity;
        });
    } else {
      this.debugLog(`Room Sensor: ${accessory.displayName} Humidity Sensor Service Not Added`);
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
  async parseStatus(device: resideoDevice & devicesConfig, sensorAccessory: sensorAccessory): Promise<void> {
    // Set Room Sensor State
    if (sensorAccessory.accessoryValue.batteryStatus.startsWith('Ok')) {
      this.Battery.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    } else {
      this.Battery.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    }
    this.debugLog(`Room Sensor: ${this.accessory.displayName} StatusLowBattery: ${this.Battery.StatusLowBattery}`);

    // Set Temperature Sensor State
    if (!device.thermostat?.roomsensor?.hide_temperature) {
      this.TemperatureSensor!.CurrentTemperature = toCelsius(sensorAccessory.accessoryValue.indoorTemperature,
        this.hap.Characteristic.TemperatureDisplayUnits.CELSIUS);
    }
    this.debugLog(`Room Sensor: ${this.accessory.displayName} CurrentTemperature: ${this.TemperatureSensor!.CurrentTemperature}°c`);

    // Set Occupancy Sensor State
    if (!device.thermostat?.roomsensor?.hide_occupancy) {
      if (sensorAccessory.accessoryValue.occupancyDet) {
        this.OccupancySensor!.OccupancyDetected = 1;
      } else {
        this.OccupancySensor!.OccupancyDetected = 0;
      }
    }

    // Set Humidity Sensor State
    if (!device.thermostat?.roomsensor?.hide_humidity) {
      this.HumiditySensor!.CurrentRelativeHumidity = sensorAccessory.accessoryValue.indoorHumidity;
    }
    this.debugLog(`Room Sensor: ${this.accessory.displayName} CurrentRelativeHumidity: ${this.HumiditySensor!.CurrentRelativeHumidity}%`);
  }

  /**
   * Asks the Resideo Home API for the latest device information
   */
  async refreshStatus(): Promise<void> {
    try {
      const roomsensors = await this.platform.getCurrentSensorData(this.location, this.device, this.group);
      const sensorAccessory = roomsensors[this.roomId][this.accessoryId];
      this.parseStatus(this.device, sensorAccessory);
      this.updateHomeKitCharacteristics();
    } catch (e: any) {
      const action = 'refreshStatus';
      if (this.device.retry) {
        // Refresh the status from the API
        interval(5000)
          .pipe(skipWhile(() => this.SensorUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.refreshStatus();
          });
      }
      this.resideoAPIError(e, action);
      this.apiError(e);
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    if (this.Battery.StatusLowBattery === undefined) {
      this.debugLog(`Room Sensor: ${this.accessory.displayName} StatusLowBattery: ${this.Battery.StatusLowBattery}`);
    } else {
      this.Battery.Service.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, this.Battery.StatusLowBattery);
      this.debugLog(`Room Sensor: ${this.accessory.displayName} updateCharacteristic StatusLowBattery: ${this.Battery.StatusLowBattery}`);
    }

    if (!this.device.thermostat?.roomsensor?.hide_temperature) {
      if (Number.isNaN(this.TemperatureSensor?.CurrentTemperature) === false) {
        if (this.TemperatureSensor?.CurrentTemperature === undefined) {
          this.debugLog(`Room Sensor: ${this.accessory.displayName} CurrentTemperature: ${this.TemperatureSensor?.CurrentTemperature}`);
        } else {
          this.TemperatureSensor.Service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, this.TemperatureSensor.CurrentTemperature);
          this.debugLog(`Room Sensor: ${this.accessory.displayName} updateCharacteristic`
            + ` CurrentTemperature: ${this.TemperatureSensor.CurrentTemperature}`);
        }
      }
    }
    if (!this.device.thermostat?.roomsensor?.hide_occupancy) {
      if (this.OccupancySensor?.OccupancyDetected === undefined) {
        this.debugLog(`Room Sensor: ${this.accessory.displayName} OccupancyDetected: ${this.OccupancySensor?.OccupancyDetected}`);
      } else {
        this.OccupancySensor.Service.updateCharacteristic(this.hap.Characteristic.OccupancyDetected, this.OccupancySensor.OccupancyDetected);
        this.debugLog(`Room Sensor: ${this.accessory.displayName} updateCharacteristic OccupancyDetected: ${this.OccupancySensor.OccupancyDetected}`);
      }
    }
    if (this.device.thermostat?.roomsensor?.hide_humidity) {
      if (this.HumiditySensor?.CurrentRelativeHumidity === undefined) {
        this.debugLog(`Room Sensor: ${this.accessory.displayName} CurrentRelativeHumidity: ${this.HumiditySensor?.CurrentRelativeHumidity}`);
      } else {
        this.HumiditySensor.Service?.updateCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity,
          this.HumiditySensor.CurrentRelativeHumidity);
        this.debugLog(`Room Sensor: ${this.accessory.displayName} updateCharacteristic`
          + ` CurrentRelativeHumidity: ${this.HumiditySensor.CurrentRelativeHumidity}`);
      }
    }
  }

  async apiError(e: any): Promise<void> {
    this.Battery.Service.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, e);
    this.Battery.Service.updateCharacteristic(this.hap.Characteristic.BatteryLevel, e);
    if (!this.device.thermostat?.roomsensor?.hide_temperature) {
      this.TemperatureSensor?.Service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, e);
    }
    if (!this.device.thermostat?.roomsensor?.hide_occupancy) {
      this.OccupancySensor?.Service.updateCharacteristic(this.hap.Characteristic.OccupancyDetected, e);
    }
    if (this.device.thermostat?.roomsensor?.hide_humidity) {
      this.HumiditySensor?.Service?.updateCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity, e);
    }
  }
}
