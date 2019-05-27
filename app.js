'use strict';

const Device = require('./models/Device')
const chalk = require('chalk');
const mosca = require('mosca');
const lodash = require('lodash');

class HuskyServer {

    constructor(mongoUrl, mqttPort, mqttUser, mqttPassword, adminUser, adminPassword) {
        this.mqttPort = mqttPort;
        this.mongoUrl = mongoUrl;
        this.mqttUser = mqttUser;
        this.mqttPassword = mqttPassword;
        this.adminUser = adminUser;
        this.adminPassword = adminPassword;

        this.deviceCount = 1;
        this.newDevicePrefix = "device ";
        this.connectedDevices = new Array();

        this.connectionCallbacks = new Array();
        this.publishCallbacks = new Array();
        this.subscritionCallback = new Array();


        let moscaStorageOptions = {
            type: 'mongo',
            url: mongoUrl,
            pubsubCollection: 'ascoltatori',
            mong: {

            }
        }
        let moscaSettings = {
            port : mqttPort,
            backend: moscaStorageOptions
        }

        let authenticate = (client, user, password, callback) => {
            console.log(`connection tried from ${chalk.blue(user.toString())} with ${chalk.blue(password.toString())} `)

            let isRegular = (user.toString() == this.mqttUser && password.toString() == this.mqttPassword);
            let isAdmin = (user.toString() == this.adminUser && password.toString() == this.adminPassword);
            let isValid = (isRegular || isAdmin);
            if (isValid) {
                client.admin = isAdmin;
            }
            callback(null, autorizado);

        }

        let publishMiddleware = (client, topic, payload, callback) => {
            callback(null, client.admin == true || topic.split('/')[0] == client.id);
        }
        let subscriptionMiddleware = (client, topic, callback) => {
            callback(null, client.admin == true || topic.split('/')[0] == client.id);
        }




        this.server = new mosca.Server(moscaSettings);

        this.server.on('clientConnected', (client) => {

            let callConnectionCallbacks = (device) => {
                console.log("calling observers...")
                this.connectionCallbacks.forEach(element => {
                    element(device, true);
                });
            }

            console.log(`${client.id} ${chalk.green("connected")}`);
            Device.findOne({
                deviceId: client.id
            }, (err, device) => {
                console.log(device);
                if (err) {
                    throw err;
                }
                
                let name = this.newDevicePrefix + this.deviceCount
                
                if (!device) {
                    let debug = (client.id.indexOf("debug_") != -1) ? true : false;
                    device = new Device({
                        deviceId: client.id,
                        topics:  new Array(),
                        name: name,
                        debug: debug
                    })
                    device.save();
                    this.AddConnectedDevice(device);

                    callConnectionCallbacks(device);
                }
                else {
                    this.AddConnectedDevice(device);
                    callConnectionCallbacks(device);
                }
            })
        });

        this.server.on('published', (packet, client) => {

            let callPublishCallbacks = (device) => {
                this.publishCallbacks.forEach(element => {
                    element(packet, device);
                });
            }

            let payload = packet.payload.toString();
            let topic = packet.topic.toString();

            let parse = topic.split('/');
            try {
                let device = this.FindDevice(parse[0])

                if (parse[1] == 'status') {
                    if (device.status != payload) {

                        if (device.topics.length > 0) {
                            let message = "sub\n";
                            for (let i = 0; i < device.topics.length; i++) {
                                device.topics.push(device.topics[i]);
                                message += device.topics[i];
                                if (typeof (device.topics[i + 1]) !== 'undefined') {
                                    message += '\r';
                                }
                            }
                            PublishMessage(parse[0], message);
                        }


                        PublishMessage(parse[0], "sts\n1");

                        lodash.forEach(device.sensors, (sensor, index) => {
                            let message = `add_sensor\n${sensor.sensorType}\r${sensor.gpio}`
                            PublishMessage(parse[0], message);
                        })


                    }
                }
                else if (parse[1] == 'ligado') {
                    let newState = (payload == "1") ? true : false;
                    device.deviceState = newState;
                    device.save();
                }
                else if (parse[1] == "tipo") {
                    device.deviceType = Number(payload);
                    device.save();
                }
                callPublishCallbacks(device);

            }
            catch (err) { }
        });

        this.server.on('clientDisconnected', (client) => {

            console.log(`${client.id} ${chalk.red("desconnected")}`);

            let callConnectionCallbacks = (device) => {
                this.connectionCallbacks.forEach(element => {
                    element(device, false);
                });
            }

            let device = FindDevice(client.id);

            if (device) {
                device.deviceState = false;
                lodash.remove(this.connectedDevices, (d) => {
                    return d == device;
                })
                callConnectionCallbacks(device);
            }
        });

        this.server.on('ready', () => {
            this.authenticate = authenticate;
            this.authorizePublish = publishMiddleware;
            this.authorizeSubscribe = subscriptionMiddleware;
        });
    }

    PublishMessage(topic, payload) {
        let message = {
            topic: topic,
            payload: payload,
            qos: 1,
            retain: false
        };

        this.server.publish(message);
        console.log(chalk.green(`${topic}:${payload.replace(/\n/g, "\/n").replace(/\r/g, "\/r")}`))
    }

    AddConnectedDevice(device) {
        this.connectedDevices.push(device);
        this.deviceCount++;
    }

    RemoveConnectedDevice(device) {
        lodash.remove(this.connectionCallbacks, (d) => {
            return device == d;
        })
    }

    AddConnectionObserver(observer) {
        this.connectionCallbacks.push(observer);
    }

    RemoveConnectionObserver(observer) {
        lodash.remove(this.connectionCallbacks, (o) => {
            return observer == o;
        })
    }

    AddSubscritionObserver(observer) {
        this.subscritionCallback.push(observer);
    }

    RemoveSubscritionObserver(observer) {
        lodash.remove(this.subscritionCallback, (o) => {
            return observer == o;
        })
    }

    AddPublishObserver(observer) {
        this.publishCallbacks.push(observer);
    }

    RemovePublishObserver(observer) {
        lodash.remove(this.publishCallbacks, (o) => {
            return observer == o;
        })
    }

    FindDevice(deviceId) {
        return lodash.find(this.connectedDevices, (device, index) => {
            return deviceId == device.deviceId;
        }, 0)
    }

    SubscribeToTopic(deviceId, topic, _callback) {
        Device.findOne(
            {
                deviceId: deviceId
            }, (err, disp) => {
                if (err) {
                    _callback(err);
                }
                else if (disp != null) {
                    if (disp.topics.length > 5) {
                        _callback("O n�mero m�ximo de t�picos para um dispositivo � 5");
                        return;
                    }

                    for (let i = 0; i < disp.topics.length; i++) {
                        if (disp.topics[i] == topic) {
                            _callback("Dispositivo j� inscrito no t�pico " + topic);
                            return;
                        }
                    }

                    this.PublishMessage(deviceId, "sub\n" + topic);
                    disp.topics.push(topic);
                    disp.save();
                    _callback(null);
                }
                else {
                    _callback("Dispositivo n�o encontrado");
                }
            });
    }
    UnsubscribeTopic(deviceId, topic, _callback) {
        topic = topic.toLowerCase();
        Device.findOne(
            {
                deviceId: deviceId
            }, (err, disp) => {

                if (err) {
                    _callback(err);
                }
                else if (disp != null) {

                    this.PublishMessage(deviceId, "unsub\n" + topic);
                    let index = disp.topics.indexOf(topic);
                    if (index != -1)
                        disp.topics.splice(index, 1);
                    disp.save();
                    _callback(null);
                }
                else {
                    _callback("Dispositivo n�o encontrado");
                }
            });
    }

    GetDevicesSubToTopic(topic) {
        return new Promise((resolve, reject) => {

            topic = topic.toLowerCase();
            let returnedDevices = new Array();

            Device.find((err, allDevices) => {
                if (err) {
                    reject(err);
                }
                else {
                    lodash.forEach(allDevices, (device) => {
                        lodash.forEach(device.topics, (deviceTopic) => {
                            if (topic.toLowerCase() == deviceTopic) {
                                returnedDevices.push(device);
                                return false; //to break the loop
                            }
                        })
                    })
                }
            })

            resolve(returnedDevices);
        });
    }

    SetDeviceStateByTopic(topic, state)
    {

        return new Promise((resolve, reject) => {
            Device.find((devices) => {
                if (err) {
                    reject(err);
                }
                else {
                    lodash.forEach(devices, (device) => {
                        lodash.forEach(device.topics, (deviceTopic) => {
                            if (topic.toLowerCase() == deviceTopic) {
                                device.deviceState = state;

                                this.SetDeviceStateById(device.deviceId, state);

                                return false; 
                            }
                        })
                    })
                    resolve();
                }
            })
        })
    }

    SetDeviceStateById(deviceId, state)
    {
        return new Promise((resolve, reject) => {

            let device = lodash.find(this.connectedDevices, (d) => {
                return d.deviceId == deviceId;
            })
    
            if(device)
            {
                device.deviceState = state;

                device.save((err) => {
                    if(err)
                    {
                        reject(err);
                    }
                    else
                    {
                        this.PublishMessage(deviceId, `tp\n${(state) ? '1' : '0'}`);
                        resolve();
                    }
                })
                
            }
            else
            {
                reject(new Error("Device not found or not connected"));
            }

        })
    }

    SetDeviceStateByName(deviceName, state)
    {
        return new Promise((resolve, reject) => {

            let device = lodash.find(this.connectedDevices, (d) => {
                return d.name == deviceName;
            })
    
            if(device)
            {
                device.deviceState = state;

                device.save((err) => {
                    if(err)
                    {
                        reject(err);
                    }
                    else
                    {
                        this.PublishMessage(device.deviceId, `tp\n${(state) ? '1' : '0'}`);
                        resolve();
                    }
                })
                
            }
            else
            {
                reject(new Error("Device not found or not connected"));
            }

        })
    }

    /**
	 * 
	 * @param {number} deviceId 
	 * @param {string} sensor 
	 * @param {string} gpio 
	 * @returns {Promise.<void>}
	 */
    AddSensor(deviceId, sensor, gpio) {
        return new Promise((resolve, reject) => {
            Device.findOne({ deviceId: deviceId },
                (err, device) => {
                    if (err) {
                        reject(err)
                    }
                    else if (!device) {
                        reject(new Error("Device not found"))
                    }
                    else {
                        let validGPIO = true

                        lodash.forEach(device.sensors, (sensor) => {
                            if(sensor.gpio == gpio)
                            {
                                validGPIO = false;
                                return false;
                            }
                        })

                        if (validGPIO) {
                            device.sensors.push({ sensorType: sensor, gpio: gpio })
                            device.save((err) => {
                                if (err) {
                                    reject(err)
                                }
                                else {
                                    let topicString = `${deviceId}`
                                    let messageString = `add_sensor\n${sensor}\r${gpio}`
                                    this.PublishMessage(topicString, messageString);
                                    resolve()
                                }
                            })
                        }
                        else {
                            reject(new Error("Only one sensor can use the same gpio"))
                        }

                    }
                }
            )
        })

    }

	/**
	 * 
	 * @param {number} deviceId 
	 * @param {string} sensor 
	 * @param {string} gpio 
	 * @returns {Promise.<void>}
	 */
    RemoveSensor(deviceId, gpio) {
        return new Promise((resolve, reject) => {
            Device.findOne({ deviceId: deviceId },
                (err, device) => {
                    if (err) {
                        reject(err)
                    }
                    else if (!device) {
                        reject(new Error("Device not found"))
                    }
                    else {

                        lodash.remove(device.sensors, (sensor) => {
                            return sensor.gpio == gpio;
                        })
                        
                        device.save((err) => {
                            if (err) {
                                reject(err)
                            }
                            else {
                                let topicString = `${deviceId}`
                                let messageString = `rem_sensor\n${gpio}`
                                this.PublishMessage(topicString, messageString);
                                resolve()
                            }
                        })


                    }
                }
            )
        })
    }

	/**
	 * 
	 * @param {number} deviceId 
	 * @param {string} sensor 
	 * @param {string} gpio 
	 * @returns {Promise.<void>}
	 */
    UpdateSensorGPIO(deviceId, sensor, gpio) {
        return new Promise((resolve, reject) => {
            Device.findOne({ deviceId: deviceId },
                (err, device) => {
                    if (err) {
                        reject(err)
                    }
                    else if (!device) {
                        reject(new Error("Device not found"))
                    }
                    else {
                        let sensorIndex = null;
                        
                        lodash.forEach(device.sensors, (s, index) => {
                            if(s.sensorType != sensor && s.gpio == gpio)
                            {
                                reject(new Error(`Another sensor has the ${gpio} gpio`))
                                return false;
                            }
                            else if(s.sensorType == s)
                            {
                                sensorIndex = index;
                                return false;
                            }
                        })

                        if(sensorIndex)
                        {
                            let oldGPIO =  device.sensors[sensorIndex].gpio;

                            let topicString = `${deviceId}/edit_sensor`
                            let messageString = `${oldGPIO}\r${gpio}`

                            device.sensors[sensorIndex].gpio = gpio;

                            device.save((err) => {
                                if (err) {
                                    reject(err)
                                }
                                else {
                                    this.PublishMessage(topicString, messageString);
                                    resolve()
                                }
                            })
                        }
                        else
                        {
                            reject(new Error("Sensor not found"));
                        }

                    }
                }
            )
        })
    }

}

module.exports = HuskyServer