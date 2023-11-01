import { Button, Input, Select, Stack, Switch } from '@mantine/core';
import { useForm } from '@mantine/form';
import React, { FC, useEffect } from 'react';
import { useOrganization } from '../../../hooks/organization/useOrganization';
import { useOrganizationUpdateMutation } from '../../../hooks/organization/useOrganizationUpdateMutation';

const OrganizationCachePanel: FC = () => {
    const { isLoading: isOrganizationLoading, data } = useOrganization();
    const {
        isLoading: isOrganizationUpdateLoading,
        mutate: updateOrganization,
    } = useOrganizationUpdateMutation();
    const isLoading = isOrganizationUpdateLoading || isOrganizationLoading;
    const form = useForm({
        initialValues: {
            isCacheEnabled: data?.isCacheEnabled || true,
            cacheStateTimeSeconds:
                data?.cacheStateTimeSeconds.toString() || '86400',
        },
    });

    const { setFieldValue } = form;

    useEffect(() => {
        if (data) {
            setFieldValue('organizationName', data?.name);
        }
    }, [data, data?.name, setFieldValue]);

    const handleOnSubmit = form.onSubmit(
        ({ isCacheEnabled, cacheStateTimeSeconds }) => {
            updateOrganization({
                isCacheEnabled,
                cacheStateTimeSeconds: parseInt(cacheStateTimeSeconds),
            });
        },
    );

    return (
        <form onSubmit={handleOnSubmit}>
            <Stack>
                <Input.Wrapper label="Enable results cache">
                    <Switch
                        style={{ marginTop: '8px' }}
                        disabled={isLoading}
                        {...form.getInputProps('isCacheEnabled', {
                            type: 'checkbox',
                        })}
                    />
                </Input.Wrapper>
                <Select
                    label="Stale period"
                    required
                    data={[
                        { value: '86400', label: '24 hours' },
                        { value: '43200', label: '12 hours' },
                        { value: '21600', label: '6 hours' },
                        { value: '14400', label: '4 hours' },
                        { value: '7200', label: '2 hours' },
                        { value: '3600', label: '1 hour' },
                        { value: '1800', label: '30 minutes' },
                        { value: '900', label: '15 minutes' },
                    ]}
                    {...form.getInputProps('cacheStateTimeSeconds')}
                />
                <Button
                    display="block"
                    ml="auto"
                    type="submit"
                    disabled={isLoading}
                    loading={isLoading}
                >
                    Update
                </Button>
            </Stack>
        </form>
    );
};

export default OrganizationCachePanel;
