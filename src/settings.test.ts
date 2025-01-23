import { describe, expect, it } from 'vitest'

import { PLATFORM_NAME } from './settings.js'

describe('settings', () => {
  it('should have the correct PLATFORM_NAME', () => {
    expect(PLATFORM_NAME).toBe('Resideo')
  })
})
