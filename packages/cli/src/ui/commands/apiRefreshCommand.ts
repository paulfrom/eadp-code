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
import type { Config } from 'eadp-code-core';
import { ApprovalMode } from 'eadp-code-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CommandKind } from './types.js';
import { loadSettings } from '../../config/settings.js';

interface SwaggerApiToolParams {
  url: string;
  username?: string;
  password?: string;
}

interface ToolResult {
  llmContent: string;
  returnDisplay: string;
}

export const apiRefreshCommand: SlashCommand = {
  name: 'apiRefresh',
  description: 'Refreshes the API information by calling the Swagger API and updating api-info.json. Can optionally target a specific tag with the --tag parameter.',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    if (!context.services.config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Configuration not available.',
      };
    }

    try {
      // Reload project-level settings each time the command is called
      const projectDir = context.services.config.getProjectRoot?.() || process.cwd();
      const loadedSettings = loadSettings(projectDir);
      const currentSettings = loadedSettings.merged;
      
      // Get swagger parameters from settings
      const url = currentSettings.swaggerUrl || undefined;
      const userName = currentSettings.swaggerUserName || undefined;
      const password = currentSettings.swaggerPassword || undefined;

      if (!url) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'No Swagger URL configured. Please set the swagger URL in the configuration.',
        };
      }

      // Parse the tag parameter from the args if it exists
      const tagMatch = args.match(/--tag\s+([^\s]+)/i);
      const tagParam = tagMatch ? tagMatch[1] : null;

      // Access the config from context
      const config = context.services.config;

      // Check for confirmation if needed
      const needsConfirmation = config.getApprovalMode() !== ApprovalMode.AUTO_EDIT;
      if (needsConfirmation) {
        // For now, we'll proceed without explicit confirmation in the command
        // but we could add a UI confirmation here if needed
      }

      // Execute the swagger API refresh directly
      const result = await executeSwaggerApi(context.services.config, {
        url,
        username: userName || undefined,
        password: password || undefined,
      }, context, tagParam);

      return {
        type: 'message',
        messageType: 'info',
        content: result.returnDisplay,
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Error refreshing API information: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

// Execute the swagger API functionality directly in the command
async function executeSwaggerApi(config: Config, params: SwaggerApiToolParams, context: CommandContext, tagParam?: string | null): Promise<ToolResult> {
  try {
    // Provide UI update that we're starting the process
    context.ui.addItem({
      type: 'info',
      text: tagParam
        ? `Starting API refresh for tag '${tagParam}' from ${params.url}...`
        : `Starting API refresh from ${params.url}...`
    }, Date.now());

    // Parse the URL to extract API path information
    const parsedUrl = new URL(params.url);

    // Construct the Swagger JSON URL by removing the hash
    let swaggerJsonUrl = params.url.split('#')[0];
    if (swaggerJsonUrl.includes('/doc.html')) {
      swaggerJsonUrl = swaggerJsonUrl.replace('/doc.html', '/v3/api-docs');
    } else if (swaggerJsonUrl.includes('/swagger-ui')) {
      swaggerJsonUrl = swaggerJsonUrl.replace(/\/swagger-ui(\/.*)?$/, '/v3/api-docs');
    } else if (!swaggerJsonUrl.includes('/v3/api-docs') && !swaggerJsonUrl.includes('/swagger.json')) {
      // If it doesn't look like a swagger JSON endpoint, try to convert it
      const baseUrl = parsedUrl.origin + parsedUrl.pathname.replace(/\/doc\.html.*$/, '') ||
        parsedUrl.origin + parsedUrl.pathname.replace(/\/swagger-ui.*$/, '') ||
        parsedUrl.origin;
      swaggerJsonUrl = `${baseUrl}/v3/api-docs`;
    }

    // Fetch the Swagger JSON
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    // Add basic authentication if credentials are provided
    if (params.username && params.password) {
      const credentials = btoa(`${params.username}:${params.password}`);
      headers['Authorization'] = `Basic ${credentials}`;
    }

    context.ui.addItem({
      type: 'info',
      text: `Fetching API specification from ${swaggerJsonUrl}...`
    }, Date.now());

    const response = await fetch(swaggerJsonUrl, {
      headers,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Swagger JSON from ${swaggerJsonUrl}. Status: ${response.status} ${response.statusText}`
      );
    }

    const swaggerData = await response.json();

    let result: string;

    // Parse all interfaces in the swagger data and save by tag
    result = await formatAndSaveAllApiInfoByTag(swaggerData, config, context, tagParam);

    return {
      llmContent: result,
      returnDisplay: tagParam
        ? `Successfully extracted API information for tag '${tagParam}' from ${params.url}`
        : `Successfully extracted API information from ${params.url}`,
    };
  } catch (error) {
    const errorMessage = `Error accessing Swagger API: ${(error as Error).message}`;
    console.error(errorMessage, error);
    return {
      llmContent: `Error: ${errorMessage}`,
      returnDisplay: `Error: ${errorMessage}`,
    };
  }
}

/**
 * Format the API information for display
 */
function formatApiInfo(pathInfo: any, apiPath: string): string {
  const { operation } = pathInfo;
  const method = pathInfo.method.toUpperCase();

  // Type the operation properly
  const typedOperation = operation as {
    summary?: string;
    description?: string;
    parameters?: Array<{
      name?: string;
      in?: string;
      description?: string;
      required?: boolean;
      type?: string;
      schema?: any;
    }>;
    requestBody?: {
      content?: Record<string, any>;
      required?: boolean;
      description?: string;
    };
    responses?: Record<string, any>;
  };

  // Construct the actual request URL by replacing path parameters with placeholders and adding query parameters
  let constructedPath = apiPath;
  const queryParams: Array<{ name: string, description: string }> = [];

  // Separate path and query parameters
  if (typedOperation.parameters && typedOperation.parameters.length > 0) {
    for (const param of typedOperation.parameters) {
      if (param.in === 'query') {
        queryParams.push({
          name: param.name || 'N/A',
          description: param.description?.replace(/\n/g, ' ') || 'No description'
        });
      }
    }
  }

  // Build the query string part
  let queryString = '';
  if (queryParams.length > 0) {
    const query = queryParams.map(p => `${p.name}=${p.description}`);

    if (query.length > 0) {
      queryString = '?' + query.join('&');
    }
  }

  const fullUrl = constructedPath + queryString;

  let result = `# API desc: ${typedOperation.summary || typedOperation.description || 'No description provided'}\n`;
  result += `## Request Type \`${method}\`\n`;
  result += `## Request URL \`${fullUrl}\`\n`;


  // Format request parameters
  result += `## Request Parameters\n`;

  // Add parameters from requestBody if it exists
  if (typedOperation.requestBody) {
    const requestBody = typedOperation.requestBody;
    const content = requestBody.content;

    if (content) {
      // Look for application/json schema as the main content type
      let schema;
      if (content['application/json']) {
        schema = content['application/json'].schema;
      } else {
        // Fallback to first available content type
        const firstType = Object.keys(content)[0];
        if (firstType && content[firstType]) {
          schema = content[firstType].schema;
        }
      }

      if (schema) {
        // If it's a $ref, try to resolve it to get the actual schema
        const resolvedSchema = resolveRef(schema, pathInfo.swaggerData?.components?.schemas);

        // Add example to the description if it's an object
        if (resolvedSchema && resolvedSchema.type === 'object' && resolvedSchema.properties) {
          try {
            const example = generateExampleFromSchema(resolvedSchema, pathInfo.swaggerData?.components?.schemas);
            result += '```json\n';
            result += JSON.stringify(example, null, 2);
            result += '\n```\n';
          } catch (e) {
            // If we can't generate example, just continue with basic description
          }
        }
      }
    }
  }

  // Format response examples
  result += `\n## Response Examples\n`;
  if (typedOperation.responses) {
    for (const [response] of Object.entries(typedOperation.responses)) {
      const typedResponse = response as { description?: string; content?: any; schema?: any };
      const schema = typedResponse.content ? getSchemaFromContent(typedResponse.content) : typedResponse.schema;

      if (schema) {
        try {
          // Resolve any $ref in the response schema
          const resolvedSchema = resolveRef(schema, pathInfo.swaggerData?.components?.schemas);
          const example = generateExampleFromSchema(resolvedSchema, pathInfo.swaggerData?.components?.schemas);
          result += '```json\n';
          result += JSON.stringify(example, null, 2);
          result += '\n```\n';
        } catch (e) {
          result += `Example: ${JSON.stringify(schema, null, 2)}\n`;
        }
      } else {
        result += 'No schema provided.\n';
      }
    }
  } else {
    result += 'No response information provided.\n';
  }

  return result;
}

/**
 * Helper to extract schema from response content
 */
function getSchemaFromContent(content: any) {
  // Look for application/json schema, or fallback to first available
  if (content['application/json']?.schema) {
    return content['application/json'].schema;
  }

  // Fallback to first available content type
  const firstType = Object.keys(content)[0];
  if (firstType && content[firstType]?.schema) {
    return content[firstType].schema;
  }

  return null;
}

/**
 * Resolves $ref references to actual schema definitions
 */
function resolveRef(schema: any, componentsSchemas: any): any {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  // Check if it's a $ref
  if (schema.$ref) {
    // Example: #/components/schemas/NextNodeBaseInfo
    const ref = schema.$ref;
    if (ref.startsWith('#/components/schemas/')) {
      const schemaName = ref.split('/').pop();
      if (schemaName && componentsSchemas && componentsSchemas[schemaName]) {
        return componentsSchemas[schemaName];
      }
    }
    // If we can't resolve the ref, return the original ref object
    return schema;
  }

  // If it's not a $ref but an object with properties, process the properties recursively
  if (schema.properties) {
    const resolvedProperties: any = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      resolvedProperties[key] = resolveRef(value, componentsSchemas);
    }
    return { ...schema, properties: resolvedProperties };
  }

  // If it's an array items definition
  if (schema.items) {
    return { ...schema, items: resolveRef(schema.items, componentsSchemas) };
  }

  return schema;
}

/**
 * Generate an example value from a schema
 */
function generateExampleFromSchema(schema: any, componentsSchemas?: any): any {
  if (schema.example !== undefined) {
    return schema.example;
  }

  // First resolve any $ref if it exists
  if (schema.$ref) {
    const resolvedSchema = resolveRef(schema, componentsSchemas);
    // Recursively call with resolved schema (which should not have $ref anymore)
    return generateExampleFromSchema(resolvedSchema, componentsSchemas);
  }

  switch (schema.type) {
    case 'string':
      return schema.format === 'date-time' ? new Date().toISOString() :
        schema.enum ? `${schema.description}(${schema.enum[0]})` : `${schema.description ? schema.description : 'string'}`;
    case 'number':
    case 'integer':
      return schema.enum ? `${schema.description}(${schema.enum[0]})` : `${schema.description ? schema.description : '0'}`;
    case 'boolean':
      return `${schema.description ? schema.description : 'true'}`;
    case 'array':
      if (schema.items) {
        // Handle $ref in array items
        const resolvedItems = resolveRef(schema.items, componentsSchemas);
        return [generateExampleFromSchema(resolvedItems, componentsSchemas)];
      }
      return [];
    case 'object':
      if (schema.properties) {
        const obj: any = {};
        for (const [key, value] of Object.entries(schema.properties)) {
          // Recursively resolve each property which might contain $ref
          const resolvedProperty = resolveRef(value, componentsSchemas);
          obj[key] = generateExampleFromSchema(resolvedProperty, componentsSchemas);
        }
        return obj;
      }
      return {};
    default:
      return schema.description;
  }
}

/**
 * Format information for all API endpoints and save them by tag to files
 */
async function formatAndSaveAllApiInfoByTag(swaggerData: any, config: Config, context: CommandContext, tagParam?: string | null): Promise<string> {
  const paths = swaggerData.paths || {};
  const allTags = swaggerData.tags || [];
  const tagGroups: Record<string, { operations: any[], description: string }> = {};

  // Create mapping from allTags for easier lookup
  const tagMap: Record<string, { name: string, description: string }> = {};
  for (const tag of allTags) {
    if (tag.name) {
      tagMap[tag.name] = {
        name: tag.name,
        description: tag.description || tag.name
      };
    }
  }

  // Group all operations by matching the first tag in the path to the allTags
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
      const typedOperation = operation as {
        tags?: string[];
        operationId?: string;
      };

      // Use the first tag if available, or use 'default' as fallback
      const operationTag = typedOperation.tags && typedOperation.tags.length > 0
        ? typedOperation.tags[0]
        : null;

      if (operationTag && tagMap[operationTag]) {
        // Match found with allTags
        const tagInfo = tagMap[operationTag];
        const tagKey = `${tagInfo.description}-${sanitizeFileName(tagInfo.name)}`;

        if (!tagGroups[tagKey]) {
          tagGroups[tagKey] = {
            operations: [],
            description: tagInfo.description
          };
        }

        tagGroups[tagKey].operations.push({ path, method, operation, swaggerData });
      } else if (operationTag) {
        // If tag not found in allTags, use the tag name directly
        const tagKey = `default-${sanitizeFileName(operationTag)}`;

        if (!tagGroups[tagKey]) {
          tagGroups[tagKey] = {
            operations: [],
            description: operationTag
          };
        }

        tagGroups[tagKey].operations.push({ path, method, operation, swaggerData });
      } else {
        // No tag for this operation, put it in a default group
        const tagKey = 'default-default';

        if (!tagGroups[tagKey]) {
          tagGroups[tagKey] = {
            operations: [],
            description: 'Default'
          };
        }

        tagGroups[tagKey].operations.push({ path, method, operation, swaggerData });
      }
    }
  }

  const apiDir = path.join(config.storage.getQwenDir(), 'api');
  fs.mkdirSync(apiDir, { recursive: true });

  // If a specific tag is provided, only process that tag
  if (tagParam) {
    // Find the tag key that matches the provided tag parameter
    let matchedTagKey = null;
    for (const tagKey of Object.keys(tagGroups)) {
      // The tag key format is {description}-{sanitized_name} or default-{sanitized_name}
      // We need to check if the tag name or description matches the parameter
      const parts = tagKey.split('-');
      if (parts.length >= 2) {
        const sanitizedName = parts.slice(1).join('-'); // Get the name part after the first dash
        const description = parts[0]; // Get the description part before the first dash
        if (sanitizedName.toLowerCase() === tagParam.toLowerCase() ||
          description.toLowerCase() === tagParam.toLowerCase() ||
          tagKey.toLowerCase() === tagParam.toLowerCase()) {
          matchedTagKey = tagKey;
          break;
        }
      }
    }

    if (matchedTagKey) {
      // Delete the existing file for this tag if it exists
      const existingFile = path.join(apiDir, `${matchedTagKey}.md`);
      if (fs.existsSync(existingFile)) {
        fs.unlinkSync(existingFile);
        context.ui.addItem({
          type: 'info',
          text: `Deleted existing API documentation file for tag '${matchedTagKey}'`
        }, Date.now());
      }

      // Process only the matching tag
      const group = tagGroups[matchedTagKey];
      const totalGroups = 1;
      const currentGroup = 1;

      // Update UI with progress
      context.ui.addItem({
        type: 'info',
        text: `Starting to process API tag '${matchedTagKey}' from Swagger API...`
      }, Date.now());

      // Provide feedback about which file is being started
      const processingMessage = `⏳ Processing (${currentGroup}/${totalGroups}): ${matchedTagKey}.md (${group.operations.length} endpoints)...`;

      // Update UI with current processing status
      context.ui.addItem({
        type: 'info',
        text: processingMessage
      }, Date.now());

      let tagContent = `# ${group.description} API Documentation\n\n`;

      // Process each operation in the tag group
      for (const [index, operationInfo] of group.operations.entries()) {
        tagContent += formatApiInfo(operationInfo, operationInfo.path);
        tagContent += `\n`;

        // Provide periodic progress updates for large groups
        if (group.operations.length > 10 && (index + 1) % Math.floor(group.operations.length / 4) === 0) {
          const progressMessage = `   Processed ${index + 1}/${group.operations.length} endpoints for ${matchedTagKey}...`;
          console.log(progressMessage);
        }
      }

      // Save the tag content to a file with description-name.md format
      const tagFilePath = path.join(apiDir, `${matchedTagKey}.md`);
      fs.writeFileSync(tagFilePath, tagContent, 'utf-8');
      const message = `Saved ${group.operations.length} endpoints for tag "${matchedTagKey}" to ${tagFilePath}`;

      // Update UI with completion status
      context.ui.addItem({
        type: 'info',
        text: `Completed processing tag: ${matchedTagKey} (${group.operations.length} endpoints)`
      }, Date.now());

      return `Successfully saved API documentation for tag '${matchedTagKey}':\n${message}`;
    } else {
      // If no matching tag is found, return an error
      const errorMessage = `No matching tag found for '${tagParam}'. Available tags: ${Object.keys(tagGroups).join(', ')}`;
      context.ui.addItem({
        type: 'info',
        text: errorMessage
      }, Date.now());
      return errorMessage;
    }
  }



  // Save each tag group to a separate file
  const results: string[] = [];
  const totalGroups = Object.keys(tagGroups).length;
  let currentGroup = 0;

  // Update UI with progress
  context.ui.addItem({
    type: 'info',
    text: `📝 Starting to process ${totalGroups} API tag files from Swagger API...`
  }, Date.now());

  console.log(`\n📝 Starting to process ${totalGroups} tag files from Swagger API...\n`);

  for (const [tagKey, group] of Object.entries(tagGroups)) {
    currentGroup++;

    // Provide feedback about which file is being started
    const processingMessage = `⏳ Processing (${currentGroup}/${totalGroups}): ${tagKey}.md (${group.operations.length} endpoints)...`;
    console.log(processingMessage);

    // Update UI with current processing status
    context.ui.addItem({
      type: 'info',
      text: processingMessage
    }, Date.now());

    let tagContent = `# ${group.description} API Documentation\n\n`;

    // Process each operation in the tag group
    for (const [index, operationInfo] of group.operations.entries()) {
      tagContent += formatApiInfo(operationInfo, operationInfo.path);
      tagContent += `\n`;

      // Provide periodic progress updates for large groups
      if (group.operations.length > 10 && (index + 1) % Math.floor(group.operations.length / 4) === 0) {
        const progressMessage = `   Processed ${index + 1}/${group.operations.length} endpoints for ${tagKey}...`;
        console.log(progressMessage);
      }
    }

    // Save the tag content to a file with description-name.md format
    const tagFilePath = path.join(apiDir, `${tagKey}.md`);
    fs.writeFileSync(tagFilePath, tagContent, 'utf-8');
    const message = `Saved ${group.operations.length} endpoints for tag "${tagKey}" to ${tagFilePath}`;
    results.push(message);
    // Provide feedback after saving each file
    const completedMessage = `✅ Completed (${currentGroup}/${totalGroups}): ${tagKey}.md (${group.operations.length} endpoints)\n`;
    console.log(completedMessage);

    // Update UI with completion status
    context.ui.addItem({
      type: 'info',
      text: `Completed processing tag: ${tagKey} (${group.operations.length} endpoints)`
    }, Date.now());
  }

  const finishedMessage = `\n🎉 Finished processing all ${totalGroups} tag files!`;
  console.log(finishedMessage);

  // Final UI update
  context.ui.addItem({
    type: 'info',
    text: `🎉 Successfully processed all ${totalGroups} API tag files! API documentation saved to ${apiDir}`
  }, Date.now());

  return `Successfully saved API documentation by tags:\n${results.join('\n')}`;
}

/**
 * Sanitize file name to remove invalid characters
 */
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}