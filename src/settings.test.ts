import { describe, expect, it } from 'vitest'

import * as settings from './settings.js'

describe('settings', () => {
  it('should have correct PLATFORM_NAME', () => {
    expect(settings.PLATFORM_NAME).toBe('Resideo')
  })

  it('should have correct PLUGIN_NAME', () => {
    expect(settings.PLUGIN_NAME).toBe('@homebridge-plugins/homebridge-resideo')
  })

  it('should have correct AuthorizeURL', () => {
    expect(settings.AuthorizeURL).toBe('https://api.honeywell.com/oauth2/authorize?')
  })

  it('should have correct TokenURL', () => {
    expect(settings.TokenURL).toBe('https://api.honeywell.com/oauth2/token')
  })

  it('should have correct LocationURL', () => {
    expect(settings.LocationURL).toBe('https://api.honeywell.com/v2/locations')
  })

  it('should have correct DeviceURL', () => {
    expect(settings.DeviceURL).toBe('https://api.honeywell.com/v2/devices')
  })

  it('should have correct HttpMethod types', () => {
    const methods: settings.HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']
    expect(methods).toEqual(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'])
  })

  it('should have correct default ResideoPlatformConfig', () => {
    const config: settings.ResideoPlatformConfig = {
      platform: 'Resideo',
      credentials: {
        accessToken: '',
        refreshToken: '',
        consumerKey: '',
        consumerSecret: '',
      },
      options: {},
      callbackUrl: '',
      port: '',
    }
    expect(config.credentials?.accessToken).toBe('')
    expect(config.credentials?.refreshToken).toBe('')
    expect(config.credentials?.consumerKey).toBe('')
    expect(config.credentials?.consumerSecret).toBe('')
    expect(config.options).toEqual({})
    expect(config.callbackUrl).toBe('')
    expect(config.port).toBe('')
  })
})
