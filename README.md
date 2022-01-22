<span align="center">

<a href="https://github.com/homebridge/verified/blob/master/verified-plugins.json"><img alt="homebridge-verified" src="https://raw.githubusercontent.com/donavanbecker/homebridge-honeywell-home/master/honeywell/Homebridge_x_Honeywell.svg?sanitize=true" width="500px"></a>

# Homebridge Honeywell Home

<a href="https://www.npmjs.com/package/homebridge-honeywell-home"><img title="npm version" src="https://badgen.net/npm/v/homebridge-honeywell-home?icon=npm&label" ></a>
<a href="https://www.npmjs.com/package/homebridge-honeywell-home"><img title="npm downloads" src="https://badgen.net/npm/dt/homebridge-honeywell-home?label=downloads" ></a>
<a href="https://discord.gg/8fpZA4S"><img title="discord-honeywell-home" src="https://badgen.net/discord/online-members/8fpZA4S?icon=discord&label=discord" ></a>
<a href="https://paypal.me/donavanbecker"><img title="donate" src="https://badgen.net/badge/donate/paypal/yellow" ></a>

<p>The Homebridge <a href="https://honeywellhome.com">Honeywell Home</a> 
plugin allows you to access your Honeywell Home Device(s) from HomeKit with
  <a href="https://homebridge.io">Homebridge</a>. 
</p>

</span>

## Installation

1. Search for "Honeywell Home" on the plugin screen of [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x).
2. Click **Install**.

## Configuration

1. Login / create an account at https://developer.honeywellhome.com/user
   - Your Honeywell Home Developer Account, this account is different then your Honeywell Home Account that you log into the Honeywell Home App with
2. Click **Create New App**
3. Give your application a name
4. Copy the hostname found on #3 of the Intro Page into the Callback URL field

<p align="center">

<img src="https://user-images.githubusercontent.com/9875439/133935459-091af658-b51c-4d69-987c-028b67b45e84.png" width="400px">

</p>

5. Enter the generated consumer key and secret into the plugin settings screen of [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x)
6. Click **Link Account**

<p align="center">

<img src="https://user-images.githubusercontent.com/9875439/133935243-1a0db200-e47a-46d4-9060-114e2704876f.png" width="400px">

</p>

7. Login to your [https://www.honeywellhome.com](https://account.honeywellhome.com).
8. Click Allow
9. Select Devices
   - I would recommend selecting all devices since you can restrict the devices you don't want in the Home app later, by DeviceID.
10. Click Connect
11. Click Save
    - If you plan on adding this plugin into a child bridge, I would configure that at this time before restarting Homebridge.
      - Reminder that you will have to add this child bridge into the home app to get honeywell accessories to show up.
12. Restart Homebridge

## Supported Honeywell Devices

- [T9 Thermostat](https://www.resideo.com/us/en/products/air/thermostats/wifi-thermostats/t9-smart-thermostat-with-sensor-rcht9610wfsw2003-u/) - Already Homekit Certified
  - [T9 Smart Roomsensors](https://www.honeywellhome.com/us/en/products/air/thermostat-accessories/t9-smart-sensor-rchtsensor-1pk-u/)
- [T6 Thermostat](https://getconnected.honeywellhome.com/en/t6) - Already Homekit Certified
- [T5 Thermostat](https://www.resideo.com/us/en/products/air/thermostats/wifi-thermostats/t5-smart-thermostat-with-c-wire-adapter-rcht8612wf2005-u/) - Already Homekit Certified
- [Round Thermostat](https://www.honeywellhome.com/us/en/products/air/thermostats/wifi-thermostats/the-round-smart-thermostat-rch9310wf5003-u/) - Already Homekit Certified
- Some Total Comfort Control Thermostats
  - Pushing Commands may not be supported on some.
