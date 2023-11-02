import {
    CacheMetadata,
    CreateWarehouseCredentials,
    deepEqual,
    Explore,
    MetricQuery,
    NotExistsError,
    UnexpectedServerError,
    UserAttributeValueMap,
    WarehouseClient,
} from '@lightdash/common';
import {
    SshTunnel,
    warehouseClientFromCredentials,
} from '@lightdash/warehouses';
import crypto from 'crypto';
import { Knex } from 'knex';
import { S3CacheClient } from '../../clients/Aws/S3CacheClient';
import { lightdashConfig } from '../../config/lightdashConfig';
import { OrganizationTableName } from '../../database/entities/organizations';
import {
    DbOrganizationMemberUserAttribute,
    DbUserAttribute,
    OrganizationMemberUserAttributesTable,
    UserAttributesTable,
} from '../../database/entities/userAttributes';
import { UserTableName } from '../../database/entities/users';
import Logger from '../../logging/logger';
import { buildQuery } from '../../queryBuilder';
import { compileMetricQuery } from '../../queryCompiler';
import { EncryptionService } from '../../services/EncryptionService/EncryptionService';
import { wrapOtelSpan } from '../../utils';

export type RunQueryTags = {
    project_uuid?: string;
    user_uuid?: string;
    organization_uuid?: string;
    chart_uuid?: string;
};

type Dependencies = {
    database: Knex;
    encryptionService: EncryptionService;
    s3CacheClient: S3CacheClient;
};

export class WarehouseModel {
    private database: Knex;

    private encryptionService: EncryptionService;

    private cachedWarehouseClients: Record<string, WarehouseClient> = {};

    private s3CacheClient: S3CacheClient;

    constructor(deps: Dependencies) {
        this.database = deps.database;
        this.encryptionService = deps.encryptionService;
        this.s3CacheClient = deps.s3CacheClient;
    }

    private async getWarehouseCredentialsForProject(
        projectUuid: string,
    ): Promise<CreateWarehouseCredentials> {
        const [row] = await this.database('warehouse_credentials')
            .innerJoin(
                'projects',
                'warehouse_credentials.project_id',
                'projects.project_id',
            )
            .select(['warehouse_type', 'encrypted_credentials'])
            .where('project_uuid', projectUuid);
        if (row === undefined) {
            throw new NotExistsError(
                `Cannot find any warehouse credentials for project.`,
            );
        }
        try {
            return JSON.parse(
                this.encryptionService.decrypt(row.encrypted_credentials),
            ) as CreateWarehouseCredentials;
        } catch (e) {
            throw new UnexpectedServerError(
                'Unexpected error: failed to parse warehouse credentials',
            );
        }
    }

    private async getAttributeValuesForOrgMember(filters: {
        organizationUuid: string;
        userUuid: string;
    }): Promise<UserAttributeValueMap> {
        const attributeValues = await this.database(UserAttributesTable)
            .leftJoin(
                OrganizationTableName,
                `${UserAttributesTable}.organization_id`,
                `${OrganizationTableName}.organization_id`,
            )
            .select<Array<Pick<DbUserAttribute, 'name' | 'attribute_default'>>>(
                `${UserAttributesTable}.name`,
                `${UserAttributesTable}.attribute_default`,
            )
            .where(
                `${OrganizationTableName}.organization_uuid`,
                filters.organizationUuid,
            );

        const userValues = await this.database(
            OrganizationMemberUserAttributesTable,
        )
            .leftJoin(
                UserTableName,
                `${OrganizationMemberUserAttributesTable}.user_id`,
                `${UserTableName}.user_id`,
            )
            .leftJoin(
                OrganizationTableName,
                `${OrganizationMemberUserAttributesTable}.organization_id`,
                `${OrganizationTableName}.organization_id`,
            )
            .leftJoin(
                UserAttributesTable,
                `${OrganizationMemberUserAttributesTable}.user_attribute_uuid`,
                `${UserAttributesTable}.user_attribute_uuid`,
            )
            .select<
                Array<
                    Pick<DbUserAttribute, 'name'> &
                        Pick<DbOrganizationMemberUserAttribute, 'value'>
                >
            >(
                `${UserAttributesTable}.name`,
                `${OrganizationMemberUserAttributesTable}.value`,
            )
            .where(
                `${OrganizationTableName}.organization_uuid`,
                filters.organizationUuid,
            )
            .where(`${UserTableName}.user_uuid`, filters.userUuid);

        const userValuesMap = userValues.reduce<Record<string, string>>(
            (acc, row) => ({ ...acc, [row.name]: row.value }),
            {},
        );
        // combine user values and default values
        return attributeValues.reduce<UserAttributeValueMap>(
            (acc, row) => ({
                ...acc,
                [row.name]: userValuesMap[row.name] || row.attribute_default,
            }),
            {},
        );
    }

    // Easier to mock in ProjectService
    // eslint-disable-next-line class-methods-use-this
    getWarehouseClientFromCredentials(credentials: CreateWarehouseCredentials) {
        return warehouseClientFromCredentials(credentials);
    }

    private async getWarehouseClient(projectUuid: string): Promise<{
        warehouseClient: WarehouseClient;
        sshTunnel: SshTunnel<CreateWarehouseCredentials>;
    }> {
        // Always load the latest credentials from the database
        const credentials = await this.getWarehouseCredentialsForProject(
            projectUuid,
        );
        // Setup SSH tunnel for client (user needs to close this)
        const sshTunnel = new SshTunnel(credentials);
        const warehouseSshCredentials = await sshTunnel.connect();

        // Check cache for existing client (always false if ssh tunnel was connected)
        const existingClient = this.cachedWarehouseClients[projectUuid] as
            | typeof this.cachedWarehouseClients[string]
            | undefined;
        if (
            existingClient &&
            deepEqual(existingClient.credentials, warehouseSshCredentials)
        ) {
            // if existing client uses identical credentials, use it
            return { warehouseClient: existingClient, sshTunnel };
        }
        // otherwise create a new client and cache for future use
        const client = this.getWarehouseClientFromCredentials(
            warehouseSshCredentials,
        );
        this.cachedWarehouseClients[projectUuid] = client;
        return { warehouseClient: client, sshTunnel };
    }

    private async getResultsFromCacheOrWarehouse({
        projectUuid,
        warehouseClient,
        query,
        metricQuery,
        queryTags,
    }: {
        projectUuid: string;
        warehouseClient: WarehouseClient;
        query: any;
        metricQuery: MetricQuery;
        queryTags?: RunQueryTags;
    }): Promise<{
        rows: Record<string, any>[];
        cacheMetadata: CacheMetadata;
    }> {
        return wrapOtelSpan(
            'ProjectService.getResultsFromCacheOrWarehouse',
            {},
            async (span) => {
                // TODO: put this hash function in a util somewhere
                const queryHash = crypto
                    .createHash('sha256')
                    .update(`${projectUuid}.${query}`)
                    .digest('hex');

                span.setAttribute('queryHash', queryHash);
                span.setAttribute('cacheHit', false);

                if (lightdashConfig.resultsCache?.enabled) {
                    const cacheEntryMetadata = await this.s3CacheClient
                        .getResultsMetadata(queryHash)
                        .catch((e) => undefined); // ignore since error is tracked in s3Client

                    if (
                        cacheEntryMetadata?.LastModified &&
                        new Date().getTime() -
                            cacheEntryMetadata.LastModified.getTime() <
                            lightdashConfig.resultsCache.cacheStateTimeSeconds *
                                1000
                    ) {
                        Logger.debug(
                            `Getting data from cache, key: ${queryHash}`,
                        );
                        const cacheEntry = await this.s3CacheClient.getResults(
                            queryHash,
                        );
                        const stringResults =
                            await cacheEntry.Body?.transformToString();
                        if (stringResults) {
                            try {
                                span.setAttribute('cacheHit', true);
                                return {
                                    rows: JSON.parse(stringResults).rows,
                                    cacheMetadata: {
                                        cacheHit: true,
                                        cacheUpdatedTime:
                                            cacheEntryMetadata?.LastModified,
                                    },
                                };
                            } catch (e) {
                                Logger.error('Error parsing cache results:', e);
                            }
                        }
                    }
                }

                Logger.debug(`Run query against warehouse warehouse`);
                const warehouseResults = await wrapOtelSpan(
                    'runWarehouseQuery',
                    {
                        query,
                        queryTags: JSON.stringify(queryTags),
                        metricQuery: JSON.stringify(metricQuery),
                        type: warehouseClient.credentials.type,
                    },
                    async () => warehouseClient.runQuery(query, queryTags),
                );

                if (lightdashConfig.resultsCache?.enabled) {
                    Logger.debug(`Writing data to cache with key ${queryHash}`);
                    const buffer = Buffer.from(
                        JSON.stringify(warehouseResults),
                    );
                    // fire and forget
                    this.s3CacheClient
                        .uploadResults(queryHash, buffer, queryTags)
                        .catch((e) => undefined); // ignore since error is tracked in s3Client
                }

                return {
                    rows: warehouseResults.rows,
                    cacheMetadata: { cacheHit: false },
                };
            },
        );
    }

    async runQuery({
        projectUuid,
        query,
        queryTags,
    }: {
        projectUuid: string;
        query: string;
        queryTags: RunQueryTags;
    }) {
        const { warehouseClient, sshTunnel } = await this.getWarehouseClient(
            projectUuid,
        );
        const results = await warehouseClient.runQuery(query, queryTags);
        await sshTunnel.disconnect();
        return results;
    }

    async compileMetricQuery({
        organizationUuid,
        projectUuid,
        userUuid,
        metricQuery,
        explore,
    }: {
        organizationUuid: string;
        projectUuid: string;
        userUuid: string;
        metricQuery: MetricQuery;
        explore: Explore;
    }) {
        const { warehouseClient, sshTunnel } = await this.getWarehouseClient(
            projectUuid,
        );

        const userAttributes = await this.getAttributeValuesForOrgMember({
            organizationUuid,
            userUuid,
        });

        const compiledMetricQuery = compileMetricQuery({
            explore,
            metricQuery,
            warehouseClient,
        });
        return buildQuery({
            explore,
            compiledMetricQuery,
            warehouseClient,
            userAttributes,
        });
    }

    async runMetricQuery({
        organizationUuid,
        projectUuid,
        userUuid,
        metricQuery,
        queryTags,
        explore,
    }: {
        organizationUuid: string;
        projectUuid: string;
        userUuid: string;
        queryTags?: RunQueryTags;
        metricQuery: MetricQuery;
        explore: Explore;
    }) {
        const { warehouseClient, sshTunnel } = await this.getWarehouseClient(
            projectUuid,
        );

        const userAttributes = await this.getAttributeValuesForOrgMember({
            organizationUuid,
            userUuid,
        });

        const compiledMetricQuery = compileMetricQuery({
            explore,
            metricQuery,
            warehouseClient,
        });
        const { query, hasExampleMetric } = buildQuery({
            explore,
            compiledMetricQuery,
            warehouseClient,
            userAttributes,
        });

        const { rows, cacheMetadata } =
            await this.getResultsFromCacheOrWarehouse({
                projectUuid,
                warehouseClient,
                query,
                metricQuery,
                queryTags,
            });
        await sshTunnel.disconnect();
        return {
            rows,
            cacheMetadata,
            query,
            hasExampleMetric,
            warehouseType: warehouseClient.credentials.type,
        };
    }
}
