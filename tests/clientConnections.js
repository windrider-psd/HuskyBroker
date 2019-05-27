const mqtt = require('mqtt');
const husky = require('./../app');

let broker = new husky("mongodb://localhost/ucmr", 1883, "usuario", "senha", "admin", "admin");

broker.AddConnectionObserver((device) => {
    console.log(device.deviceId);
})


let client = mqtt.connect("mqtt://localhost:1883", {
    clientId: "test",
    username : "usuario",
    password : "senha",
});





