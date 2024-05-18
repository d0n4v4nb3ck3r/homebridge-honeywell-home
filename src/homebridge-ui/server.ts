/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * server.ts: homebridge-resideo.
 */
/* eslint-disable no-console */
import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import { API } from 'homebridge';
//import { AuthorizeURL, TokenURL } from '../settings.js';
//import { request } from 'undici';
import { AuthorizeURL, PLATFORM_NAME } from '../settings.js';
import { createServer } from 'http';
import fs, { readFileSync } from 'fs';
import url from 'url';
import { exec as execCb } from 'child_process';
import util from 'util';
const exec = util.promisify(execCb);

class PluginUiServer extends HomebridgePluginUiServer {
  public readonly api!: API;
  public key!: string;
  public secret!: string;
  public hostname!: string;
  public callbackUrl!: string;
  public port!: string;
  constructor() {
    super();
    this.onRequest('Start Resideo Login Server', (): any => {
      const runningServer = createServer(async (req, res) => {
        try {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          const urlParts = url.parse(req.url || '', true);
          const pathArr = urlParts.pathname ? urlParts.pathname.split('?') : [];
          const action = pathArr[0].replace('/', '');
          const query = urlParts.query;

          const currentConfig = JSON.parse(readFileSync(this.api.user.configPath(), 'utf8'));

          // check the platforms section is an array before we do array things on it
          if (!Array.isArray(currentConfig.platforms)) {
            throw new Error('Cannot find platforms array in config');
          }

          // find this plugins current config
          const pluginConfig = currentConfig.platforms.find((x: { platform: string }) => x.platform === PLATFORM_NAME);

          if (!pluginConfig) {
            throw new Error(`Cannot find config for ${PLATFORM_NAME} in platforms array`);
          }
          if (pluginConfig.port) {
            this.port = pluginConfig.port;
          } else {
            this.port = '8585';
          }
          if (pluginConfig.callbackUrl) {
            this.callbackUrl = pluginConfig.callbackUrl;
          } else {
            this.callbackUrl = 'http://' + this.hostname + ':' + this.port + '/auth';
          }
          switch (action) {
            case 'start': {
              this.key = query.key as string;
              this.secret = query.secret as string;
              this.hostname = query.host as string;
              const url = AuthorizeURL + 'response_type=code&redirect_uri=' + encodeURI(this.callbackUrl) + '&'
                + 'client_id=' + query.key;
              res.end('<script>window.location.replace(\'' + url + '\');</script>');
              break;
            }
            case 'auth': {
              if (query.code) {
                /*const code = query.code;
                const auth = Buffer.from(this.key + ':' + this.secret).toString('base64');
                const { body, statusCode } = await request(TokenURL, {
                  body: JSON.stringify({
                    'grant_type': 'authorization_code',
                    'code': code,
                    'redirect_uri': encodeURI('http://' + this.hostname + ':8585/auth'),
                  }),
                  headers: {
                    'Authorization': `Basic ${auth}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                  method: 'POST',
                });
                console.log(`(Token) body: ${JSON.stringify(body)}, statusCode: ${statusCode}`);
                const response: any = await body.text();
                console.log(`(Token) response: ${response}, statusCode: ${statusCode}`);
                const code = query.code;
                const auth = Buffer.from(this.key + ':' + this.secret).toString('base64');
                let curlString = '';
                curlString += 'curl -X POST ';
                curlString += '--header "Authorization: Basic ' + auth + '" ';
                curlString += '--header "Accept: application/json" ';
                curlString += '--header "Content-Type: application/x-www-form-urlencoded" ';
                curlString += '-d "';
                curlString += 'grant_type=authorization_code&';
                curlString += 'code=' + code + '&';
                curlString += 'redirect_uri=' + encodeURI('http://' + this.hostname + ':8585/auth');
                curlString += '" ';
                curlString += '"https://api.honeywell.com/oauth2/token"';
                try {
                  const { stdout } = await exec(curlString);
                  const response = JSON.parse(String(stdout));
                try {
                  if (response.access_token) {
                    this.pushEvent('creds-received', {
                      access: response.access_token,
                      key: this.key,
                      refresh: response.refresh_token,
                      secret: this.secret,
                    });
                    res.end('Success. You can close this window now.');
                  } else {
                    res.end('Failed to get access token. Close this window and start again');
                  }
                } catch (err) {
                  res.end('<strong>An error occurred:</strong><br>' + JSON.stringify(err) + '<br><br>Close this window and start again');
                }*/
                const code = query.code;
                const auth = Buffer.from(this.key + ':' + this.secret).toString('base64');
                let curlString = '';
                curlString += 'curl -X POST ';
                curlString += '--header "Authorization: Basic ' + auth + '" ';
                curlString += '--header "Accept: application/json" ';
                curlString += '--header "Content-Type: application/x-www-form-urlencoded" ';
                curlString += '-d "';
                curlString += 'grant_type=authorization_code&';
                curlString += 'code=' + code + '&';
                curlString += 'redirect_uri=' + encodeURI(this.callbackUrl);
                curlString += '" ';
                curlString += '"https://api.honeywell.com/oauth2/token"';
                try {
                  const { stdout } = await exec(curlString);
                  if (stdout) {
                    const response = JSON.parse(stdout.toString());
                    if (response.access_token) {
                      this.pushEvent('creds-received', {
                        key: this.key,
                        secret: this.secret,
                        access: response.access_token,
                        refresh: response.refresh_token,
                      });
                      res.end('Success. You can close this window now.');
                    } else {
                      console.log(`(auth) response: ${JSON.stringify(response)}`);
                      res.end('oops.');
                    }
                  } else {
                    console.log(`(auth) stdout: ${JSON.stringify(stdout)}`);
                    res.end('<strong>An error occurred:</strong><br>Close this window and start again');
                  }
                } catch (err) {
                  console.log(`(auth) err: ${JSON.stringify(err)}`);
                  res.end('<strong>An error occurred:</strong><br>' + JSON.stringify(err) + '<br><br>Close this window and start again');
                }
              } else {
                res.end('<strong>An error occurred:</strong><br>no code received<br><br>Close this window and start again');
              }
              break;
            } default: {
              // should never happen
              res.end('welcome to the server');
              break;
            }
          }// end switch
        } catch (err) {
          console.log(err);
        }
      });
      runningServer.listen(this.port, () => {
        console.log('Server is running');
      });
      setTimeout(() => {
        runningServer.close();
      }, 300000);
    });



    /*
  A native method getCachedAccessories() was introduced in config-ui-x v4.37.0
  The following is for users who have a lower version of config-ui-x
*/


    this.onRequest('getCachedAccessories', () => {
      try {
        const plugin = 'homebridge-resideo';
        const devicesToReturn = [];

        // The path and file of the cached accessories
        const accFile = this.homebridgeStoragePath + '/accessories/cachedAccessories';

        // Check the file exists
        if (fs.existsSync(accFile)) {
          // read the cached accessories file
          const cachedAccessories: any[] = JSON.parse(fs.readFileSync(accFile, 'utf8'));

          cachedAccessories.forEach((accessory: any) => {
            // Check the accessory is from this plugin
            if (accessory.plugin === plugin) {
              // Add the cached accessory to the array
              devicesToReturn.push(accessory.accessory as never);
            }
          });
        }
        // Return the array
        return devicesToReturn;
      } catch {
        // Just return an empty accessory list in case of any errors
        return [];
      }
    });
    this.ready();
  }
}

function startPluginUiServer(): PluginUiServer {
  return new PluginUiServer();
}

startPluginUiServer();