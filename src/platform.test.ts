import type { API, Logging } from 'homebridge'
import type { MockedFunction } from 'vitest'

import type { ResideoPlatformConfig } from './settings.js'

import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResideoPlatform } from './platform.js'

vi.mock('axios')

describe('resideoPlatform', () => {
  let platform: ResideoPlatform
  let log: Logging
  let config: ResideoPlatformConfig
  let api: API

  beforeEach(() => {
    log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logging

    config = {
      platform: 'Resideo',
      name: 'Test Platform',
      credentials: {
        accessToken: 'testAccessToken',
        consumerKey: 'testConsumerKey',
        consumerSecret: 'testConsumerSecret',
        refreshToken: 'testRefreshToken',
      },
      options: {
        refreshRate: 120,
        pushRate: 0.1,
        devices: [],
      },
    }

    api = {
      hap: {
        uuid: {
          generate: vi.fn().mockReturnValue('test-uuid'),
        },
      },
      platformAccessory: vi.fn().mockImplementation((name, uuid) => ({
        displayName: name,
        UUID: uuid,
        context: {},
      })),
      user: {
        configPath: vi.fn().mockReturnValue('/path/to/config.json'),
      },
      on: vi.fn(),
      updatePlatformAccessories: vi.fn(),
    } as unknown as API

    platform = new ResideoPlatform(log, config, api)
  })

  it('should initialize platform with given config', () => {
    expect(platform.config.name).toBe('Test Platform')
    expect(platform.config.credentials?.accessToken).toBe('testAccessToken')
  })

  it('should verify config correctly', () => {
    expect(() => platform.verifyConfig()).not.toThrow()
  })

  it('should throw error if refresh rate is less than 30', () => {
    if (platform.config.options) {
      platform.config.options.refreshRate = 20
    }
    expect(() => platform.verifyConfig()).toThrow('Refresh Rate must be above 30 seconds.')
  })

  it('should refresh access token', async () => {
    (axios.post as MockedFunction<typeof axios.post>).mockResolvedValue({
      data: {
        access_token: 'newAccessToken',
        refresh_token: 'newRefreshToken',
      },
    })

    await platform.refreshAccessToken()

    expect(platform.config.credentials?.accessToken).toBe('newAccessToken')
    expect(platform.config.credentials?.refreshToken).toBe('newRefreshToken')
  })

  it('should discover locations', async () => {
    const mockLocations = [{ locationID: '1', name: 'Location 1', devices: [] }];
    (axios.get as MockedFunction<typeof axios.get>).mockResolvedValue({ data: mockLocations })

    const locations = await platform.discoverlocations()

    expect(locations).toEqual(mockLocations)
  })

  it('should handle error during location discovery', async () => {
    (axios.get as MockedFunction<typeof axios.get>).mockRejectedValue(new Error('Network Error'))

    await expect(platform.discoverlocations()).rejects.toThrow('Network Error')
  })
})
