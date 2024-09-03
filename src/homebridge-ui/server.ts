/* eslint-disable no-console */
import type { API } from 'homebridge'

import { Buffer } from 'node:buffer'
import { exec as execCb } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import url from 'node:url'
import util from 'node:util'

/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * server.ts: homebridge-resideo.
 */
import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils'

const exec = util.promisify(execCb)

class PluginUiServer extends HomebridgePluginUiServer {
  public readonly api!: API
  public key!: string
  public secret!: string
  public hostname!: string
  public callbackUrl!: string
  public port!: string
  constructor() {
    super()
    this.onRequest('Start Resideo Login Server', async () => {
      const runningServer = http.createServer(async (req, res) => {
        try {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          const urlParts = new url.URL(req.url ?? '', 'http://localhost')
          const pathArr = urlParts.pathname ? urlParts.pathname.split('?') : []
          const action = pathArr[0].replace('/', '')
          const query = urlParts.searchParams
          switch (action) {
            case 'start': {
              this.key = query.keys() as unknown as string
              this.secret = (query as any).secret as string
              this.hostname = urlParts.host as string
              const url = `https://api.honeywell.com/oauth2/authorize?`
                + `response_type=code&redirect_uri=${encodeURI(`http://${this.hostname}:8585/auth`)}&`
                + `client_id=${query.keys}`
              res.end(`<script>window.location.replace('${url}');</script>`)
              break
            }
            case 'auth': {
              if (query.get('code')) {
                const code = query.get('code')
                const auth = Buffer.from(`${this.key}:${this.secret}`).toString('base64')
                let curlString = ''
                curlString += 'curl -X POST '
                curlString += `--header "Authorization: Basic ${auth}" `
                curlString += '--header "Accept: application/json" '
                curlString += '--header "Content-Type: application/x-www-form-urlencoded" '
                curlString += '-d "'
                curlString += 'grant_type=authorization_code&'
                curlString += `code=${code}&`
                curlString += `redirect_uri=${encodeURI(`http://${this.hostname}:8585/auth`)}`
                curlString += '" '
                curlString += '"https://api.honeywell.com/oauth2/token"'
                try {
                  const { stdout } = await exec(curlString)
                  const response = JSON.parse(stdout)
                  if (response.access_token) {
                    this.pushEvent('creds-received', {
                      key: this.key,
                      secret: this.secret,
                      access: response.access_token,
                      refresh: response.refresh_token,
                    })
                    res.end('Success. You can close this window now.')
                  } else {
                    res.end('oops.')
                  }
                } catch (err) {
                  res.end(`<strong>An error occurred:</strong><br>${JSON.stringify(err)}<br><br>Close this window and start again`)
                }
              } else {
                res.end('<strong>An error occurred:</strong><br>no code received<br><br>Close this window and start again')
              }
              break
            }
            default: {
              // should never happen
              res.end('welcome to the server')
              break
            }
          }
        } catch (err) {
          console.log(err)
        }
      })
      runningServer.listen(8585, () => {
        console.log('Server is running')
      })

      setTimeout(() => {
        runningServer.close()
      }, 300000)
    })

    /*
      A native method getCachedAccessories() was introduced in config-ui-x v4.37.0
      The following is for users who have a lower version of config-ui-x
    */

    this.onRequest('/getCachedAccessories', async () => {
      try {
        // Define the plugin and create the array to return
        const plugin = 'homebridge-resideo'
        const devicesToReturn = []

        // The path and file of the cached accessories
        const accFile = `${this.homebridgeStoragePath}/accessories/cachedAccessories`

        // Check the file exists
        if (fs.existsSync(accFile)) {
          // read the cached accessories file
          const cachedAccessories: any[] = JSON.parse(fs.readFileSync(accFile, 'utf8'))

          cachedAccessories.forEach((accessory: any) => {
            // Check the accessory is from this plugin
            if (accessory.plugin === plugin) {
              // Add the cached accessory to the array
              devicesToReturn.push(accessory.accessory as never)
            }
          })
        }
        // Return the array
        return devicesToReturn
      } catch {
        // Just return an empty accessory list in case of any errors
        return []
      }
    })
    this.ready()
  }
}

(() => new PluginUiServer())()
