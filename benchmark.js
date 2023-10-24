var Benchmark = require('benchmark');
var {formatRows, formatRowsWithoutSpread, formatRowsWithMap} = require('@lightdash/common');
var { faker } = require('@faker-js/faker');
const {Worker} = require("worker_threads");
const {runWorkerThread} = require("backend/dist/utils");

function generateRow() {
    return {
        userId: faker.string.uuid(),
        username: faker.internet.userName(),
        email: faker.internet.email(),
        age: faker.number.int(),
        password: faker.internet.password(),
        birthdate: faker.date.birthdate(),
        registeredAt: faker.date.past(),
        extra: null,
        isAdult: faker.datatype.boolean(),
    };
}

const createRows = (size) => {
    return Array.from({length: size}, generateRow);
}

const ITEM_MAP = {
    userId: {
        fieldType: 'dimension',
        type: 'string',
    },
    username: {
        fieldType: 'dimension',
        type: 'string',
    },
    email: {
        fieldType: 'dimension',
        type: 'string',
    },
    password: {
        fieldType: 'dimension',
        type: 'string',
    },
    age: {
        fieldType: 'dimension',
        type: 'number',
    },
    birthdate: {
        fieldType: 'dimension',
        type: 'date',
    },
    registeredAt: {
        fieldType: 'dimension',
        type: 'date',
    },
    extra: {
        fieldType: 'dimension',
        type: 'string',
    },
    isAdult: {
        fieldType: 'dimension',
        type: 'boolean',
    },
}


const suite = new Benchmark.Suite;
const RESULTS = createRows(5000);


function start() {
    console.time('perfCheck');
    console.log("Long Running Function Start", RESULTS[0]);
    // const formatted = formatRows(RESULTS, ITEM_MAP);
    const formatted = runWorkerThread(
        new Worker(
            './dist/services/ProjectService/formatRows.js',
            {
                workerData: {
                    rows,
                    itemMap,
                },
            },
        )
    );

    console.log("Long Running Function End", formatted[0]);
    console.timeEnd('perfCheck');
}

start();

// suite
//     .add('with spread', function () {
//         formatRows(RESULTS, ITEM_MAP);
//     })
//     .on('cycle', function(event) {
//         console.log(String(event.target));
//     })
//     .on('complete', function () {
//         console.log(`With ${RESULTS.length} rows, the fastest is ` + this.filter('fastest').map('name'));
//     })
//     .run({'async': false});