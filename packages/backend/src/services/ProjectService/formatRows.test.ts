import { faker } from '@faker-js/faker';
import {
    Compact,
    CompactOrAlias,
    CompiledDimension,
    CompiledField,
    Format,
    formatRows,
    ResultRow,
    TableCalculation,
} from '@lightdash/common';
import { Worker } from 'worker_threads';
import { runWorkerThread } from '../../utils';

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

const createRows = (size: number) => Array.from({ length: size }, generateRow);

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
};

const ITEM_MAP_WITH_FORMATTING = {
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
        compact: Compact.MILLIONS,
        round: 2,
        format: Format.GBP,
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
};

// Mock results with X rows
const RESULTS = createRows(5000);

// How many times each tests runs formatRows
const RUNS = 1;
const TEST_TIMEOUT = 10000;

test(
    'formatRows in worker',
    async () => {
        console.time('perfCheck');
        const promises = Array.from({ length: RUNS }, () =>
            runWorkerThread<ResultRow[]>(
                new Worker('./dist/services/ProjectService/formatRows.js', {
                    workerData: {
                        rows: RESULTS,
                        itemMap: ITEM_MAP,
                    },
                }),
            ),
        );
        await Promise.all(promises);
        console.timeEnd('perfCheck');
    },
    TEST_TIMEOUT,
);

test(
    'formatRows without worker',
    async () => {
        console.time('perfCheck');
        Array.from({ length: RUNS }, () =>
            formatRows(
                RESULTS,
                ITEM_MAP as any as Record<
                    string,
                    CompiledField | TableCalculation
                >,
            ),
        );
        console.timeEnd('perfCheck');
    },
    TEST_TIMEOUT,
);
