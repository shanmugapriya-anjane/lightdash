import { createTokenAuth } from '@octokit/auth-token';
import { Octokit } from '@octokit/core';
import { request } from '@octokit/request';
import { Octokit as OktokitRest } from '@octokit/rest';

import {
    Controller,
    Get,
    OperationId,
    Query,
    Request,
    Route,
    SuccessResponse,
} from '@tsoa/runtime';
import express from 'express';
import { nanoid } from 'nanoid';
import { githubApp } from '../clients/github/Github';
import { lightdashConfig } from '../config/lightdashConfig';

const { createAppAuth } = require('@octokit/auth-app');

const githubAppName = 'lightdash-dev';
const githubClientId = 'aaaa';

const installationId = 47029382; // replace this once it is installed

/** HOW it works
 *
 * First install the app in the project
 * using /api/v1/github/install?projectUuid=3675b69e-8324-4110-bdca-059031aa8da3
 *
 * This will redirect to the github app to the callback page
 * Write down the refresh token (not sure if we need it) and installation_id (currently hardcoded)
 *
 * and then you can use it on /api/v1/github/list
 * or /api/v1/github/create-branch to create a branch and push some code.
 *
 *
 */
@Route('/api/v1/github')
export class GithubInstallController extends Controller {
    /**
     * Install the Lightdash GitHub App and link to a project
     *
     * @param projectUuid The uuid of the project
     * @param redirect The url to redirect to after installation
     * @param req express request
     */
    @SuccessResponse('302', 'Not found')
    @Get('/install')
    @OperationId('githubAppInstall')
    async getGithubInstallOnProject(
        @Request() req: express.Request,
        @Query() projectUuid: string,
        @Query() redirect?: string,
    ): Promise<void> {
        const redirectUrl = new URL(redirect || '/', lightdashConfig.siteUrl);
        const state = nanoid();
        req.session.oauth = {};
        req.session.oauth.returnTo = redirectUrl.href;
        req.session.oauth.state = state;
        req.session.oauth.projectUuid = projectUuid;
        this.setStatus(302);
        this.setHeader(
            'Location',
            `https://github.com/apps/${githubAppName}/installations/new?state=${state}`,
        );
    }

    /**
     * Login to GitHub and authorize (not install) GitHub App
     *
     * @param req express request
     * @param redirect The url to redirect to after authorization
     */
    @SuccessResponse('302', 'Not found')
    @OperationId('githubOauthLogin')
    async githubOauthLogin(
        @Request() req: express.Request,
        @Query() redirect?: string,
    ): Promise<void> {
        const state = nanoid();
        const redirectUrl = new URL(redirect || '/', lightdashConfig.siteUrl);
        req.session.oauth = {};
        req.session.oauth.state = state;
        req.session.oauth.returnTo = redirectUrl.href;
        this.setStatus(302);
        this.setHeader(
            'Location',
            `https://github.com/login/oauth/authorize?client_id=${githubClientId}&state=${state}`,
        );
    }

    /**
     * Callback URL for GitHub App Authorization also used for GitHub App Installation with combined Authorization
     *
     * @param req {express.Request} express request
     * @param code {string} authorization code from GitHub
     * @param state {string} oauth state parameter
     * @param installation_id {string} installation id from GitHub
     * @param setup_action {string} setup action from GitHub
     */
    @Get('/oauth/callback')
    @OperationId('githubOauthCallback')
    async githubOauthCallback(
        @Request() req: express.Request,
        @Query() code?: string,
        @Query() state?: string,
        @Query() installation_id?: string,
        @Query() setup_action?: string,
    ): Promise<void> {
        console.log('code', code);
        console.log('state', state);
        console.log('installation_id', installation_id);
        console.log('setup_action', setup_action);

        if (state !== req.session.oauth?.state) {
            this.setStatus(400);
            throw new Error('State does not match');
        }
        if (setup_action === 'review') {
            // User attempted to setup the app, didn't have permission in GitHub and sent a request to the admins
            // We can't do anything at this point
            this.setStatus(200);
        }

        /*   if (code) {
        }if (setup_action === 'install' && installation_id && code) {
            // User successfully installed the app
            console.log('installation_id', installation_id)
            const userToServerToken = await githubApp.oauth.createToken({
                code,
            });
            console.log('userToServerToken', userToServerToken)
            const userOctokit = new Octokit({
                authStrategy: createTokenAuth,
                auth: userToServerToken.authentication.token,
            });
            const response = await userOctokit.request(
                'GET /user/installations',
            );
            const installation = response.data.installations.find(
                (i) => `${i.id}` === installation_id,
            );
            if (installation === undefined) {
                this.setStatus(400);
                throw new Error('Installation not found');
            }

            // store installation id
        }
        if (code && !installation_id) {
            const userToServerToken = await githubApp.oauth.createToken({
                code,
            });
            // store userToServerToken
        } */
        const redirectUrl = new URL(req.session.oauth?.returnTo || '/');
        req.session.oauth = {};
        this.setStatus(302);
        this.setHeader('Location', redirectUrl.href);
    }

    @SuccessResponse('200')
    @Get('/list')
    @OperationId('githubList')
    async getGithubListBranches(@Request() req: express.Request): Promise<any> {
        console.log('req', req);
        this.setStatus(200);

        const appOctokit = new OktokitRest({
            authStrategy: createAppAuth,
            auth: {
                appId: 703670,
                privateKey: process.env.GITHUB_PRIVATE_KEY,
                // optional: this will make appOctokit authenticate as app (JWT)
                //           or installation (access token), depending on the request URL
                installationId,
            },
        });

        const { data } = await appOctokit.rest.repos.listBranches({
            owner: 'rephus',
            repo: 'jaffle_shop',
        });

        return data;
    }

    @SuccessResponse('201')
    @Get('/create-branch')
    @OperationId('createBranch')
    async createBranch(@Request() req: express.Request): Promise<any> {
        this.setStatus(200);

        console.log('req', req);
        const appOctokit = new OktokitRest({
            authStrategy: createAppAuth,
            auth: {
                appId: 703670,
                privateKey: process.env.GITHUB_PRIVATE_KEY,
                // optional: this will make appOctokit authenticate as app (JWT)
                //           or installation (access token), depending on the request URL
                installationId,
            },
        });

        const results = appOctokit.rest.git.createRef({
            owner: 'rephus',
            repo: 'jaffle_shop',
            ref: 'refs/heads/new-branch',
            sha: '5ade538a80d6d638031069d7d8bafde2d2c2b567',
        });

        console.log('update file ', results);
        return results;
    }

    @SuccessResponse('201')
    @Get('/update-file')
    @OperationId('updateFile')
    async updateFile(@Request() req: express.Request): Promise<any> {
        this.setStatus(200);

        console.log('req', req);

        const appOctokit = new OktokitRest({
            authStrategy: createAppAuth,
            auth: {
                appId: 703670,
                privateKey: process.env.GITHUB_PRIVATE_KEY,
                // optional: this will make appOctokit authenticate as app (JWT)
                //           or installation (access token), depending on the request URL
                installationId,
            },
        });
        // convert strint to base64
        const s = 'foo';

        const response = appOctokit.rest.repos.createOrUpdateFileContents({
            owner: 'rephus',
            repo: 'jaffle_shop',
            path: 'new_file3.md.',
            message: 'Update dbt project from octokit',
            content: Buffer.from(s, 'utf-8').toString('base64'),
            sha: '5ade538a80d6d638031069d7d8bafde2d2c2b567',
            branch: 'new-branch',
            committer: {
                name: 'Javier Rengel',
                email: 'rephus@gmail.com',
            },
            author: {
                name: 'Javier Rengel',
                email: 'rephus@gmail.com',
            },
        });
        console.log('update file ', response);
        return response;
    }
}