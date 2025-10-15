/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from './types.js';
import { SwaggerApiTool } from '@qwen-code/qwen-code-core';
import { CommandKind } from './types.js';
import { update } from 'lodash';

export const apiRefreshCommand: SlashCommand = {
  name: 'apiRefresh',
  description: 'Refreshes the API information by calling the Swagger API and updating api-info.json.',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    _args: string,
  ): Promise<SlashCommandActionReturn> => {
    if (!context.services.config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Configuration not available.',
      };
    }
    
    try {
      const {url, userName, password} = context.services.config.getSwaggerParameters();
      
      if (!url) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'No Swagger URL configured. Please set the swagger URL in the configuration.',
        };
      }

      // Call the swagger API tool to refresh API information
      const config = context.services.config; // Store in local variable to avoid type issues
      const swaggerTool = new SwaggerApiTool(config!); // Non-null assertion since we checked it above
      // Use the public buildAndExecute method with an abort signal
      const abortController = new AbortController();
      const swaggerResult = await swaggerTool.buildAndExecute({
        url,
        username: userName || undefined,
        password: password || undefined,
      }, abortController.signal);

      // Write the result to apiInfoFileName
      if (swaggerResult.llmContent && typeof swaggerResult.llmContent === 'string') {
        return {
          type: 'message',
          messageType: 'info',
          content: `API information successfully refreshed and saved to .eadp/api/*.md`,
        };
      } else {
        return {
          type: 'message',
          messageType: 'error',
          content: 'No API information was returned from the Swagger API call.',
        };
      }
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Error refreshing API information: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};