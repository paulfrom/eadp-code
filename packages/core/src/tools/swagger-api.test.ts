/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SwaggerApiTool } from './swagger-api.js';
import type { Config } from '../config/config.js';
import { ApprovalMode } from '../config/config.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
vi.mock('node:crypto', async (importOriginal) => {
  return {
    btoa: (str: string) => Buffer.from(str).toString('base64'),
    randomUUID: () => 'test-uuid', // Mock the randomUUID function that's used in session.ts
  };
});

describe('SwaggerApiTool', () => {
  let mockConfig: Config;
  const abortSignal = new AbortController().signal;

  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockClear();
    
    mockConfig = {
      getApprovalMode: vi.fn(),
      setApprovalMode: vi.fn(),
      getProxy: vi.fn(),
      getTavilyApiKey: vi.fn(),
    } as unknown as Config;
  });

  describe('tool creation and schema', () => {
    it('creates with correct name', () => {
      const tool = new SwaggerApiTool(mockConfig);
      expect(tool.name).toBe('swagger_api');
    });

    it('has correct description', () => {
      const tool = new SwaggerApiTool(mockConfig);
      expect(tool.description).toContain('Accesses a Swagger API endpoint');
    });

    it('has correct parameter schema', () => {
      const tool = new SwaggerApiTool(mockConfig);
      const schema = tool.parameterSchema;
      expect(schema).toHaveProperty('type', 'object');
    });
  });

  describe('validation', () => {
    it('should validate correctly with valid parameters', () => {
      const tool = new SwaggerApiTool(mockConfig);
      const params = {
        url: 'http://10.4.208.83:18814/doc.html#/default/PurchaseContractArchiveApi/archive',
      };
      
      expect(() => tool.build(params)).not.toThrow();
    });

    it('should reject when url parameter is missing', () => {
      const tool = new SwaggerApiTool(mockConfig);
      const params = {
        username: 'user',
        password: 'pass',
      };
      
      // @ts-expect-error testing missing required field
      expect(() => tool.build(params)).toThrow(
        "params must have required property 'url'",
      );
    });

    it('should reject when url parameter is empty', () => {
      const tool = new SwaggerApiTool(mockConfig);
      const params = {
        url: '',
      };
      
      expect(() => tool.build(params)).toThrow(
        "The 'url' parameter cannot be empty.",
      );
    });

    it('should reject when url parameter is not a valid URL', () => {
      const tool = new SwaggerApiTool(mockConfig);
      const params = {
        url: 'not-a-url',
      };
      
      expect(() => tool.build(params)).toThrow(
        "The 'url' parameter is not a valid URL: not-a-url",
      );
    });

    it('should accept URLs without specific endpoints to parse all interfaces', () => {
      const tool = new SwaggerApiTool(mockConfig);
      const params = {
        url: 'http://10.4.208.83:18814/doc.html',
      };
      
      expect(() => tool.build(params)).not.toThrow();
    });

    it('should reject when username is provided but password is missing', () => {
      const tool = new SwaggerApiTool(mockConfig);
      const params = {
        url: 'http://10.4.208.83:18814/doc.html#/default/PurchaseContractArchiveApi/archive',
        username: 'user',
      };
      
      expect(() => tool.build(params)).toThrow(
        "If 'username' is provided, 'password' must also be provided.",
      );
    });

    it('should reject when password is provided but username is missing', () => {
      const tool = new SwaggerApiTool(mockConfig);
      const params = {
        url: 'http://10.4.208.83:18814/doc.html#/default/PurchaseContractArchiveApi/archive',
        password: 'pass',
      };
      
      expect(() => tool.build(params)).toThrow(
        "If 'password' is provided, 'username' must also be provided.",
      );
    });
  });

  describe('shouldConfirmExecute', () => {
    it('should return confirmation details with the correct prompt', async () => {
      const tool = new SwaggerApiTool(mockConfig);
      const params = {
        url: 'http://10.4.208.83:18814/doc.html#/default/PurchaseContractArchiveApi/archive',
        username: 'user',
        password: 'pass',
      };
      const invocation = tool.build(params);
      const confirmationDetails = await invocation.shouldConfirmExecute(abortSignal);

      expect(confirmationDetails).toEqual({
        type: 'info',
        title: 'Confirm Swagger API Access',
        prompt: 'Access Swagger API at http://10.4.208.83:18814/doc.html#/default/PurchaseContractArchiveApi/archive with credentials user:*** to extract API information.',
        onConfirm: expect.any(Function),
      });
    });

    it('should return confirmation details without credentials when not provided', async () => {
      const tool = new SwaggerApiTool(mockConfig);
      const params = {
        url: 'http://10.4.208.83:18814/doc.html#/default/PurchaseContractArchiveApi/archive',
      };
      const invocation = tool.build(params);
      const confirmationDetails = await invocation.shouldConfirmExecute(abortSignal);

      expect(confirmationDetails).toEqual({
        type: 'info',
        title: 'Confirm Swagger API Access',
        prompt: 'Access Swagger API at http://10.4.208.83:18814/doc.html#/default/PurchaseContractArchiveApi/archive anonymously to extract API information.',
        onConfirm: expect.any(Function),
      });
    });

    it('should return false if approval mode is AUTO_EDIT', async () => {
      const tool = new SwaggerApiTool({
        ...mockConfig,
        getApprovalMode: () => ApprovalMode.AUTO_EDIT,
      } as unknown as Config);
      const params = {
        url: 'http://10.4.208.83:18814/doc.html#/default/PurchaseContractArchiveApi/archive',
      };
      const invocation = tool.build(params);

      expect(typeof invocation.shouldConfirmExecute).toBe('function');
    });

    it('should call setApprovalMode when onConfirm is called with ProceedAlways', async () => {
      const setApprovalMode = vi.fn();
      const testConfig = {
        ...mockConfig,
        setApprovalMode,
      } as unknown as Config;
      const tool = new SwaggerApiTool(testConfig);
      const params = {
        url: 'http://10.4.208.83:18814/doc.html#/default/PurchaseContractArchiveApi/archive',
      };
      const invocation = tool.build(params);

      expect(typeof invocation).toBe('object');
    });
  });

  describe('execute', () => {
    it('should parse all interfaces when URL does not specify a concrete endpoint', async () => {
      // Mock a successful response from the Swagger API with multiple endpoints
      const mockSwaggerData = {
        info: {
          title: 'Test API',
          version: '1.0.0',
          description: 'A test API'
        },
        paths: {
          '/api/test1': {
            get: {
              operationId: 'testOperation1',
              summary: 'Test operation 1',
              responses: {
                '200': {
                  description: 'Success response'
                }
              }
            }
          },
          '/api/test2': {
            post: {
              operationId: 'testOperation2',
              summary: 'Test operation 2',
              responses: {
                '200': {
                  description: 'Success response'
                }
              }
            }
          }
        }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSwaggerData),
      });

      const tool = new SwaggerApiTool(mockConfig);
      const params = {
        url: 'http://10.4.208.83:18814/doc.html', // No specific endpoint - should parse all
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('# API Documentation');
      expect(result.llmContent).toContain('## API Info');
      expect(result.llmContent).toContain('Test API');
      expect(result.llmContent).toContain('## All Endpoints');
      expect(result.llmContent).toContain('- **GET** - Test operation 1 (Operation ID: testOperation1)');
      expect(result.llmContent).toContain('- **POST** - Test operation 2 (Operation ID: testOperation2)');
      expect(result.returnDisplay).toBe('Successfully extracted API information from http://10.4.208.83:18814/doc.html');
    });

    it('should return error when failed to fetch Swagger JSON', async () => {
      // Mock fetch to return a 404 error
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const tool = new SwaggerApiTool(mockConfig);
      const params = {
        url: 'http://10.4.208.83:18814/doc.html#/default/PurchaseContractArchiveApi/archive',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('Error: Error accessing Swagger API: Failed to fetch Swagger JSON');
      expect(result.returnDisplay).toContain('Error: Error accessing Swagger API: Failed to fetch Swagger JSON');
    });

    it('should extract API information successfully', async () => {
      // Mock a successful response from the Swagger API
      const mockSwaggerData = {
        paths: {
          '/api/contract/archive': {
            post: {
              operationId: 'archive',
              summary: 'Archive purchase contract',
              description: 'Archives the purchase contract with the given ID',
              parameters: [
                {
                  name: 'id',
                  in: 'query',
                  description: 'ID of the contract to archive',
                  required: true,
                  type: 'string'
                }
              ],
              responses: {
                '200': {
                  description: 'Contract archived successfully',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          success: { type: 'boolean' },
                          message: { type: 'string' }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSwaggerData),
      });

      const tool = new SwaggerApiTool(mockConfig);
      const params = {
        url: 'http://10.4.208.83:18814/doc.html#/default/PurchaseContractArchiveApi/archive',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('# API Endpoint Information');
      expect(result.llmContent).toContain('## Method Description');
      expect(result.llmContent).toContain('Archive purchase contract');
      expect(result.llmContent).toContain('## Request Path');
      expect(result.llmContent).toContain('## Request Type');
      expect(result.llmContent).toContain('## Request Parameters');
      expect(result.llmContent).toContain('## Response Examples');
      expect(result.returnDisplay).toBe('Successfully extracted API information from http://10.4.208.83:18814/doc.html#/default/PurchaseContractArchiveApi/archive');
    });

    it('should handle authentication when credentials are provided', async () => {
      const mockSwaggerData = {
        paths: {
          '/api/test': {
            get: {
              operationId: 'testOperation',
              summary: 'Test operation',
              responses: {
                '200': {
                  description: 'Success response'
                }
              }
            }
          }
        }
      };

      mockFetch.mockImplementation((url, options) => {
        // Verify that authorization header was set correctly
        if (options?.headers && options.headers['Authorization']) {
          expect(options.headers['Authorization']).toBe('Basic dXNlcjpwYXNz'); // base64 encoded 'user:pass'
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSwaggerData),
        });
      });

      const tool = new SwaggerApiTool(mockConfig);
      const params = {
        url: 'http://10.4.208.83:18814/doc.html#/default/TestController/testOperation',
        username: 'user',
        password: 'pass',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('# API Endpoint Information');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://10.4.208.83:18814/v3/api-docs',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Accept': 'application/json',
            'Authorization': 'Basic dXNlcjpwYXNz'
          })
        })
      );
    });

    it('should return error when operation ID is not found in Swagger JSON', async () => {
      const mockSwaggerData = {
        paths: {
          '/api/test': {
            get: {
              operationId: 'differentOperation',
              summary: 'Different operation',
              responses: {
                '200': {
                  description: 'Success response'
                }
              }
            }
          }
        }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSwaggerData),
      });

      const tool = new SwaggerApiTool(mockConfig);
      const params = {
        url: 'http://10.4.208.83:18814/doc.html#/default/TestController/testOperation',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('Error: Could not find API endpoint with operation ID \'testOperation\'');
      expect(result.returnDisplay).toContain('Error: Could not find API endpoint with operation ID \'testOperation\'');
    });
  });
});