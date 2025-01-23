import { describe, expect, it } from 'vitest'

import { toCelsius } from './utils.js'

describe('toCelsius', () => {
  it('should return the same value if the unit is 0 (Celsius)', () => {
    expect(toCelsius(25, 0)).toBe(25)
  })

  it('should convert Fahrenheit to Celsius correctly', () => {
    expect(toCelsius(32, 1)).toBe(0) // 32°F is 0°C
    expect(toCelsius(68, 1)).toBe(20) // 68°F is 20°C
    expect(toCelsius(100, 1)).toBe(37.5) // 100°F is 37.5°C
  })

  it('should round to the nearest 0.5 degree', () => {
    expect(toCelsius(33, 1)).toBe(0.5) // 33°F is 0.5°C
    expect(toCelsius(34, 1)).toBe(1) // 34°F is 1°C
  })
})
