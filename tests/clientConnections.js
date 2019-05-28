const mqtt = require('mqtt');
const husky = require('./../app');

let broker = new husky("mongodb://localhost/ucmr", 1883, "usuario", "senha", "admin", "admin");

broker.OnReady(true, () => {

    broker.AddConnectionObserver((device) => {
        broker.SubscribeDeviceToTopic(device.deviceId, "testTopic")
            .then(() => {
                console.log("sub")
                broker.UnsubscribeDeviceTopic(device.deviceId, "testTopic")
                    .then(() => {
                        console.log("unsub")
                    })
            })
            .catch(err => {
                
            });
    })
    
    
    let client = mqtt.connect("mqtt://localhost:1883", {
        clientId: "test",
        username : "usuario",
        password : "senha",
    });


});









