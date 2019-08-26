const mqtt = require('mqtt');
const husky = require('./../app');

let broker = new husky.HuskyServer("mongodb://localhost/ucmr", "", "", 1883, "usuario", "senha", "admin", "admin");
let logger = new husky.HuskyServerConsoleLogger(broker);

broker.OnReady(true, () => {

});









