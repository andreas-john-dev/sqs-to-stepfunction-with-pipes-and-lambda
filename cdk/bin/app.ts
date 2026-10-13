#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { SqsSfnStack } from '../lib/sqs-sfn-stack';

const app = new cdk.App();
new SqsSfnStack(app, 'SqsToStepFunctions', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
