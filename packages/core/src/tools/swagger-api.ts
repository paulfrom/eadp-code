/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import type { Config } from '../config/config.js';
import { ApprovalMode } from '../config/config.js';
import type {
  ToolCallConfirmationDetails,
  ToolInfoConfirmationDetails,
} from './tools.js';
import { ToolConfirmationOutcome } from './tools.js';

/**
 * Parameters for the Swagger API tool
 */
export interface SwaggerApiToolParams {
  /**
   * The Swagger API endpoint URL
   */
  url: string;
  /**
   * Username for authentication (optional)
   */
  username?: string;
  /**
   * Password for authentication (optional)
   */
  password?: string;
}

/**
 * Implementation of the Swagger API tool invocation logic
 */
class SwaggerApiToolInvocation extends BaseToolInvocation<
  SwaggerApiToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: SwaggerApiToolParams,
  ) {
    super(params);
  }

  override getDescription(): string {
    return `Accessing Swagger API at ${this.params.url} to extract API information`;
  }

  override async shouldConfirmExecute(): Promise<
    ToolCallConfirmationDetails | false
  > {
    if (this.config.getApprovalMode() === ApprovalMode.AUTO_EDIT) {
      return false;
    }

    const confirmationDetails: ToolInfoConfirmationDetails = {
      type: 'info',
      title: 'Confirm Swagger API Access',
      prompt: `Access Swagger API at ${this.params.url} ${this.params.username ? `with credentials ${this.params.username}:***` : 'anonymously'
        } to extract API information.`,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        }
      },
    };
    return confirmationDetails;
  }

  async execute(): Promise<ToolResult> {
    try {
      // Parse the URL to extract API path information
      const parsedUrl = new URL(this.params.url);
      const pathParts = parsedUrl.hash.split('/').filter(part => part !== ''); // Remove empty parts

      // Construct the Swagger JSON URL by removing the hash
      let swaggerJsonUrl = this.params.url.split('#')[0];
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
      if (this.params.username && this.params.password) {
        const credentials = btoa(`${this.params.username}:${this.params.password}`);
        headers['Authorization'] = `Basic ${credentials}`;
      }

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

      // If pathParts has elements, parse specific operation; otherwise parse all operations
      if (pathParts.length >= 2) {
        // Extract the operation ID from the hash part
        // Path format: #/{tag}/{operationId} or #/{tag}/{controller}/{operationId}
        const operationId = pathParts[pathParts.length - 1]; // Last part is usually the operation ID

        // Find the corresponding operation in the Swagger JSON using the operation ID
        const pathInfo = this.findApiPathInfoByOperationId(swaggerData, operationId);

        if (!pathInfo) {
          return {
            llmContent: `Error: Could not find API endpoint with operation ID '${operationId}' in Swagger JSON from ${swaggerJsonUrl}`,
            returnDisplay: `Error: Could not find API endpoint with operation ID '${operationId}' in Swagger JSON from ${swaggerJsonUrl}`,
          };
        }

        // Extract and format the API information for the specific endpoint
        result = this.formatApiInfo(pathInfo, pathInfo.path);
      } else {
        // Parse all interfaces in the swagger data
        result = this.formatAllApiInfo(swaggerData);
      }

      return {
        llmContent: result,
        returnDisplay: `Successfully extracted API information from ${this.params.url}`,
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
   * Find the API path information in the Swagger JSON based on the operation ID
   */
  private findApiPathInfoByOperationId(swaggerData: any, operationId: string): any {
    // Look through all paths and methods to find the operation by ID
    const paths = swaggerData.paths || {};
    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
        if (operation.operationId === operationId) {
          return { path, method, operation, swaggerData };
        }
      }
    }
    return null;
  }

  /**
   * Format the API information for display
   */
  private formatApiInfo(pathInfo: any, apiPath: string): string {
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
    const pathParams: Array<{name: string, description: string}> = [];
    const queryParams: Array<{name: string, description: string, required: boolean}> = [];
    
    // Separate path and query parameters
    if (typedOperation.parameters && typedOperation.parameters.length > 0) {
      for (const param of typedOperation.parameters) {
        if (param.in === 'path') {
          pathParams.push({
            name: param.name || 'N/A',
            description: param.description?.replace(/\n/g, ' ') || 'No description'
          });
        } else if (param.in === 'query') {
          queryParams.push({
            name: param.name || 'N/A',
            description: param.description?.replace(/\n/g, ' ') || 'No description',
            required: !!param.required
          });
        }
      }
    }
    
    // Build the query string part
    let queryString = '';
    if (queryParams.length > 0) {
      const requiredQueryParams = queryParams.filter(p => p.required).map(p => `${p.name}=<value>`);
      const optionalQueryParams = queryParams.filter(p => !p.required).map(p => `[${p.name}=<value>]`);
      
      const allQueryParts = [...requiredQueryParams, ...optionalQueryParams];
      if (allQueryParts.length > 0) {
        queryString = '?' + allQueryParts.join('&');
      }
    }
    
    const fullUrl = constructedPath + queryString;
    
    let result = `# API Endpoint Information\n\n`;
    result += `## Method Description\n${typedOperation.summary || typedOperation.description || 'No description provided'}\n\n`;
    result += `## Request Type\n\`${method}\`\n\n`;
    result += `## Request URL\n\`${fullUrl}\`\n\n`;


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
          const resolvedSchema = this.resolveRef(schema, pathInfo.swaggerData?.components?.schemas);

          // Add example to the description if it's an object
          if (resolvedSchema && resolvedSchema.type === 'object' && resolvedSchema.properties) {
            try {
              const example = this.generateExampleFromSchema(resolvedSchema, pathInfo.swaggerData?.components?.schemas);
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
      for (const [statusCode, response] of Object.entries(typedOperation.responses)) {
        const typedResponse = response as { description?: string; content?: any; schema?: any };
        const description = typedResponse.description || 'No description';
        const schema = typedResponse.content ? this.getSchemaFromContent(typedResponse.content) : typedResponse.schema;

        result += `### Status ${statusCode}: ${description}\n`;
        if (schema) {
          try {
            // Resolve any $ref in the response schema
            const resolvedSchema = this.resolveRef(schema, pathInfo.swaggerData?.components?.schemas);
            const example = this.generateExampleFromSchema(resolvedSchema, pathInfo.swaggerData?.components?.schemas);
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
  private getSchemaFromContent(content: any) {
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
  private resolveRef(schema: any, componentsSchemas: any): any {
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
        resolvedProperties[key] = this.resolveRef(value, componentsSchemas);
      }
      return { ...schema, properties: resolvedProperties };
    }

    // If it's an array items definition
    if (schema.items) {
      return { ...schema, items: this.resolveRef(schema.items, componentsSchemas) };
    }

    return schema;
  }

  /**
   * Generate an example value from a schema
   */
  private generateExampleFromSchema(schema: any, componentsSchemas?: any): any {
    if (schema.example !== undefined) {
      return schema.example;
    }

    // First resolve any $ref if it exists
    if (schema.$ref) {
      const resolvedSchema = this.resolveRef(schema, componentsSchemas);
      // Recursively call with resolved schema (which should not have $ref anymore)
      return this.generateExampleFromSchema(resolvedSchema, componentsSchemas);
    }

    switch (schema.type) {
      case 'string':
        return schema.format === 'date-time' ? new Date().toISOString() :
          schema.format === 'email' ? 'user@example.com' :
            schema.enum ? schema.enum[0] : 'string';
      case 'number':
      case 'integer':
        return schema.enum ? schema.enum[0] : 0;
      case 'boolean':
        return true;
      case 'array':
        if (schema.items) {
          // Handle $ref in array items
          const resolvedItems = this.resolveRef(schema.items, componentsSchemas);
          return [this.generateExampleFromSchema(resolvedItems, componentsSchemas)];
        }
        return [];
      case 'object':
        if (schema.properties) {
          const obj: any = {};
          for (const [key, value] of Object.entries(schema.properties)) {
            // Recursively resolve each property which might contain $ref
            const resolvedProperty = this.resolveRef(value, componentsSchemas);
            obj[key] = this.generateExampleFromSchema(resolvedProperty, componentsSchemas) + (schema.properties[key].description ? ` // ${schema.properties[key].description}` : '');
          }
          return obj;
        }
        return {};
      default:
        return {};
    }
  }

  /**
   * Format information for all API endpoints
   */
  private formatAllApiInfo(swaggerData: any): string {
    const paths = swaggerData.paths || {};
    let result = `# API Documentation\n\n`;

    if (swaggerData.info) {
      result += `## API Info\n`;
      result += `- **Title:** ${swaggerData.info.title || 'N/A'}\n`;
      result += `- **Version:** ${swaggerData.info.version || 'N/A'}\n`;
      result += `- **Description:** ${swaggerData.info.description || 'N/A'}\n\n`;
    }

    result += `## All Endpoints\n\n`;

    for (const [path] of Object.entries(paths)) {
      const pathParts = path.split('/').filter(part => part !== '');
      const operationId = pathParts[pathParts.length - 1]; // Last part is usually the operation ID

      // Find the corresponding operation in the Swagger JSON using the operation ID
      const pathInfo = this.findApiPathInfoByOperationId(swaggerData, operationId);

      if (!pathInfo) {
        result += `Could not find detailed info for operation ID '${operationId}'.\n\n`;
        continue;
      }

      // Extract and format the API information for the specific endpoint
      result += this.formatApiInfo(pathInfo, pathInfo.path);

      result += `\n`;
    }

    return result;
  }
}

/**
 * Implementation of the Swagger API tool
 */
export class SwaggerApiTool extends BaseDeclarativeTool<
  SwaggerApiToolParams,
  ToolResult
> {
  static readonly Name: string = 'swagger_api';

  constructor(private readonly config: Config) {
    super(
      SwaggerApiTool.Name,
      'Swagger API',
      'Accesses a Swagger API endpoint and extracts API information including method description, request path, request type, parameters with descriptions, and response examples. Input parameters are a URL to the Swagger interface, with optional username and password for authentication. The URL must specify a concrete API endpoint (e.g., http://10.4.208.83:18814/doc.html#/default/PurchaseContractArchiveApi/archive)',
      Kind.Fetch,
      {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to the Swagger interface with a specific API endpoint specified in the fragment (e.g., http://10.4.208.83:18814/doc.html#/default/PurchaseContractArchiveApi/archive)',
          },
          username: {
            type: 'string',
            description: 'Username for authentication (optional)',
          },
          password: {
            type: 'string',
            description: 'Password for authentication (optional)',
          },
        },
        required: ['url'],
      },
    );
  }

  /**
   * Validates the parameters for the SwaggerApiTool.
   * @param params The parameters to validate
   * @returns An error message string if validation fails, null if valid
   */
  protected override validateToolParamValues(
    params: SwaggerApiToolParams,
  ): string | null {
    if (!params.url || params.url.trim() === '') {
      return "The 'url' parameter cannot be empty.";
    }

    try {
      new URL(params.url);
    } catch (e) {
      return `The 'url' parameter is not a valid URL: ${params.url}`;
    }

    // Allow both specific endpoints (e.g., #/default/PurchaseContractArchiveApi/archive) 
    // and base URLs (which will parse all interfaces)
    const pathParts = params.url.split('#')[1]?.split('/') || [];
    // If pathParts exist, validate that they have at least 2 segments for specific endpoints
    if (pathParts.length > 0 && pathParts.length < 2) {
      return `The URL must specify a concrete API endpoint (e.g., #/default/PurchaseContractArchiveApi/archive) or no specific endpoint to parse all interfaces. The provided URL does not specify a valid endpoint: ${params.url}`;
    }

    if (params.username && !params.password) {
      return "If 'username' is provided, 'password' must also be provided.";
    }

    if (params.password && !params.username) {
      return "If 'password' is provided, 'username' must also be provided.";
    }

    return null;
  }

  protected createInvocation(
    params: SwaggerApiToolParams,
  ): ToolInvocation<SwaggerApiToolParams, ToolResult> {
    return new SwaggerApiToolInvocation(this.config, params);
  }
}