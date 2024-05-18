/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * util.ts: homebridge-resideo platform class.
 */

/**
 * Converts the value to celsius if the temperature units are in Fahrenheit
**/
export function convertUnits(value: number, unit: string, convert?: string): number {
  if (unit === 'CELSIUS' && convert === 'CELSIUS') {
    return Math.round((value * 9) / 5 + 32);
  } else if (unit === 'FAHRENHEIT' && convert === 'FAHRENHEIT') {
    // celsius should be to the nearest 0.5 degree
    return Math.round((5 / 9) * (value - 32) * 2) / 2;
  }
  return value;
}

/**
 * Converts the value to celsius if the temperature units are in Fahrenheit
 */
export function toCelsius(value: number, unit: number): number {
  if (unit === 0) {
    return value;
  }

  // celsius should be to the nearest 0.5 degree
  return Math.round((5 / 9) * (value - 32) * 2) / 2;
}

/**
 * Converts the value to fahrenheit if the temperature units are in Fahrenheit
 */
export function toFahrenheit(value: number, unit: number): number {
  if (unit === 0) {
    return value;
  }

  return Math.round((value * 9) / 5 + 32);
}

// Map HomeKit Modes to Resideo Modes
export enum HomeKitModes {
  Off = 0,  //this.hap.Characteristic.TargetHeatingCoolingState.OFF
  Heat = 1, //this.hap.Characteristic.TargetHeatingCoolingState.HEAT
  Cool = 2, //this.hap.Characteristic.TargetHeatingCoolingState.COOL
  Auto = 3, //this.hap.Characteristic.TargetHeatingCoolingState.AUTO
}

// Don't change the order of these!
export enum ResideoModes {
  Off = 'Off',
  Heat = 'Heat',
  Cool = 'Cool',
  Auto = 'Auto'
};

/*
export enum holdModes {
  NoHold = 0, //this.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
  TemporaryHold = 1, //this.hap.Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS
  PermanentHold = 2, //this.hap.Characteristic.ProgrammableSwitchEvent.LONG_PRESS
}

export enum fanModes {
  Auto = 0, //this.hap.Characteristic.TargetFanState.AUTO
  On = 1, //this.hap.Characteristic.TargetFanState.ON
}

export type resideoHold = {
  NoHold: 'NoHold',
  TemporaryHold: 'TemporaryHold',
  PermanentHold: 'PermanentHold'
};*/