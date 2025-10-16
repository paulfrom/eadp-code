/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config } from '../config/config.js';
import { ToolNames } from './tool-names.js';
import type { ToolInvocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';

/**
 * Parameters for the Query API tool
 * Used to search API documentation for specific endpoints, fields, and methods
 * Supports English and Chinese queries for finding API information
 */
export interface QueryApiToolParams {
  /**
   * Search query to match API information (e.g., "user", "用户", "create", "创建", "get", "获取", etc.)
   * Use this field to find specific API endpoints, methods, or parameters for page generation
   */
  query: string;
  /**
   * Optional: specific tag to search within (e.g., "users-api", "订单管理", "products", etc.)
   * Use to narrow down search to specific API groups
   */
  tag?: string;
  /**
   * Optional: specific endpoint path to search for (e.g., "/api/users", "/v1/products", etc.)
   */
  endpoint_path?: string;
}

class QueryApiToolInvocation extends BaseToolInvocation<QueryApiToolParams, ToolResult> {
  constructor(
    private readonly config: Config,
    params: QueryApiToolParams,
  ) {
    super(params);
  }

  override getDescription(): string {
    let description = `Searching for API information matching: "${this.params.query}"`;
    if (this.params.tag) {
      description += ` in tag: "${this.params.tag}"`;
    }
    if (this.params.endpoint_path) {
      description += ` for endpoint: "${this.params.endpoint_path}"`;
    }
    return description;
  }

  async execute(): Promise<ToolResult> {
    try {
      // Get the API directory path
      const apiDir = path.join(this.config.storage.getGeminiDir(), 'api');
      
      if (!fs.existsSync(apiDir)) {
        return {
          llmContent: `未找到API文档目录 ${apiDir}。请先运行 /apiRefresh 命令生成API文档。\nNo API documentation directory found at ${apiDir}. Please run the swagger_api tool first to generate API documentation.`,
          returnDisplay: `API documentation directory not found`,
        };
      }

      // Get all API documentation files
      const apiFiles = fs.readdirSync(apiDir).filter(file => 
        file.endsWith('.md') && file.includes('api')
      );

      if (apiFiles.length === 0) {
        return {
          llmContent: `在 ${apiDir} 中未找到API文档文件。请先运行 /apiRefresh 命令生成API文档。\nNo API documentation files found in ${apiDir}. Please run the swagger_api tool first to generate API documentation.`,
          returnDisplay: `No API documentation files found`,
        };
      }

      // Search for matching information
      const results: string[] = [];
      const query = this.params.query.toLowerCase();
      const tagFilter = this.params.tag?.toLowerCase();
      const endpointPathFilter = this.params.endpoint_path?.toLowerCase();

      for (const file of apiFiles) {
        // Skip if tag filter is specified and doesn't match
        if (tagFilter && !file.toLowerCase().includes(tagFilter)) {
          continue;
        }

        const filePath = path.join(apiDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');

        // Extract API sections based on markdown headings
        const sections = this.extractApiSections(content);
        
        for (const section of sections) {
          // Check if the section matches our query criteria
          if (this.isSectionMatching(section, query, endpointPathFilter)) {
            // Extract the relevant API information
            const apiInfo = this.extractApiInfo(section, query);
            if (apiInfo) {
              results.push(apiInfo);
            }
          }
        }
      }

      if (results.length === 0) {
        // Try enhanced search with synonyms and related terms for better Chinese language matching
        const enhancedQuery = this.expandQuery(this.params.query);
        if (enhancedQuery !== query) {
          // If we have expanded the query, try again with expanded terms
          for (const file of apiFiles) {
            if (tagFilter && !file.toLowerCase().includes(tagFilter)) {
              continue;
            }

            const filePath = path.join(apiDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            const sections = this.extractApiSections(content);
            
            for (const section of sections) {
              // Check against expanded query terms
              const expandedTerms = enhancedQuery.split(' ');
              for (const term of expandedTerms) {
                if (this.isSectionMatching(section, term, endpointPathFilter)) {
                  const apiInfo = this.extractApiInfo(section, this.params.query);
                  if (apiInfo && !results.some(r => r.includes(apiInfo))) {
                    results.push(apiInfo);
                    break;
                  }
                }
              }
            }
          }
        }

        // If still no results, return with suggestions
        if (results.length === 0) {
          return {
            llmContent: `未找到与查询 "${this.params.query}" 匹配的API信息。请尝试其他搜索词或检查API文档是否已生成。\nNo API information found matching query: "${this.params.query}". Please try different search terms or check if API documentation has been generated. You can try more specific terms like 'user', 'get', 'create', '订单', '用户', '获取', '创建', etc.`,
            returnDisplay: `No matching API information found`,
          };
        }
      }

      const resultMessage = `找到 ${results.length} 个匹配查询 "${this.params.query}" 的API接口:\n\n${results.join('\n---\n')}\n\nFound ${results.length} API interface(s) matching query "${this.params.query}":\n\n${results.join('\n---\n')}`;
      
      return {
        llmContent: resultMessage,
        returnDisplay: `Found ${results.length} matching API interface(s)`,
      };
    } catch (error) {
      const errorMessage = `查询API信息时出错: ${(error as Error).message}\nError querying API information: ${(error as Error).message}`;
      console.error(errorMessage, error);
      return {
        llmContent: `错误: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
      };
    }
  }

  /**
   * Extract API sections from the markdown content
   */
  private extractApiSections(content: string): string[] {
    // Split content by headers to identify different API operations
    const sections: string[] = [];
    const lines = content.split('\n');
    let currentSection = '';
    
    for (const line of lines) {
      if (line.startsWith('# ') || line.startsWith('## ')) {
        if (currentSection.trim() !== '') {
          sections.push(currentSection);
        }
        currentSection = line + '\n';
      } else {
        currentSection += line + '\n';
      }
    }
    
    if (currentSection.trim() !== '') {
      sections.push(currentSection);
    }
    
    return sections;
  }

  /**
   * Check if a section matches the query criteria
   */
  private isSectionMatching(section: string, query: string, endpointPathFilter?: string): boolean {
    const lowerSection = section.toLowerCase();
    const lowerQuery = query.toLowerCase();
    
    // Check if the section contains the query (with enhanced matching for better recognition)
    // Match on API description, method, URL, parameters, or any content
    if (!lowerSection.includes(lowerQuery)) {
      // Additional matching for common API patterns and partial matches
      // Check for common API verbs in Chinese and English
      const apiVerbs = ['get', 'post', 'put', 'delete', 'patch', 'create', 'update', 'delete', '获取', '创建', '更新', '删除', '查询', 'page', 'list'];
      const hasApiVerbMatch = apiVerbs.some(verb => 
        lowerQuery.includes(verb) && 
        (lowerSection.includes(verb) || lowerSection.includes('method: ' + verb.toUpperCase()))
      );
      
      if (!hasApiVerbMatch) {
        return false;
      }
    }
    
    // If endpoint path filter is specified, check if the section contains it
    if (endpointPathFilter && !lowerSection.includes(endpointPathFilter.toLowerCase())) {
      return false;
    }
    
    return true;
  }

  /**
   * Extract API information from a section based on the query
   */
  private extractApiInfo(section: string, query: string): string | null {
    try {
      // Extract API description
      const descMatch = section.match(/# API desc: (.+)/);
      let description = descMatch ? descMatch[1] : 'No description';
      
      // Try to extract Chinese description if available
      if (description.includes('，') || description.includes('。') || /[\u4e00-\u9fa5]/.test(description)) {
        // If the description has Chinese characters, preserve the original
        const chineseDescMatch = section.match(/# API desc: ([^\n]+)/);
        if (chineseDescMatch) {
          description = chineseDescMatch[1];
        }
      }

      // Extract request type
      const methodMatch = section.match(/## Request Type `(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE)`/i);
      const method = methodMatch ? methodMatch[1] : 'Unknown';

      // Extract request URL
      const urlMatch = section.match(/## Request URL `([^`]+)`/);
      const url = urlMatch ? urlMatch[1] : 'Unknown';

      // Extract request parameters (from JSON example if available)
      const paramStartIndex = section.indexOf('```json');
      let parameters = 'No parameters found';
      
      if (paramStartIndex !== -1) {
        const jsonBlock = section.substring(paramStartIndex);
        const jsonEndIndex = jsonBlock.indexOf('```', 7); // Start after first ```
        
        if (jsonEndIndex !== -1) {
          const jsonContent = jsonBlock.substring(7, jsonEndIndex).trim();
          try {
            const parsedJson = JSON.parse(jsonContent);
            parameters = this.extractParameters(parsedJson, 0);
          } catch (e) {
            // If JSON parsing fails, just return the raw JSON string
            parameters = `Raw request example:\n${jsonContent}`;
          }
        }
      }

      // Extract response examples
      const responseSection = section.substring(section.toLowerCase().indexOf('## response examples'));
      const responseLines = responseSection.split('\n');
      let responseExample = 'No response example';
      
      for (let i = 0; i < responseLines.length; i++) {
        if (responseLines[i].includes('```json')) {
          let jsonContent = '';
          for (let j = i + 1; j < responseLines.length; j++) {
            if (responseLines[j].includes('```')) {
              break;
            }
            jsonContent += responseLines[j] + '\n';
          }
          if (jsonContent.trim()) {
            try {
              const parsedResponse = JSON.parse(jsonContent.trim());
              responseExample = this.extractResponseFields(parsedResponse, 0);
              break;
            } catch (e) {
              responseExample = `Response example:\n${jsonContent.trim()}`;
              break;
            }
          }
        }
      }

      // Format the result in a more structured way that's useful for page generation
      let result = `# API: ${description}\n`;
      result += `## Method: ${method}\n`;
      result += `## Endpoint: ${url}\n`;
      
      // Add tags if available (for better organization)
      const tagMatches = section.match(/(# \w+ API Documentation)/);
      if (tagMatches) {
        const tagName = tagMatches[1].replace('# ', '').replace(' API Documentation', '');
        result += `## API Group: ${tagName}\n`;
      }
      
      result += `## Request Fields:\n${parameters}\n`;
      result += `## Response Fields:\n${responseExample}\n`;
      
      // Also include the query term for reference
      result += `## Query Match: ${query}\n`;
      
      return result;
    } catch (e) {
      console.error('Error extracting API info:', e);
      return `Error extracting API information from section: ${section.substring(0, 100)}...`;
    }
  }

  /**
   * Extract parameter fields from a JSON object recursively
   */
  private extractParameters(obj: any, depth: number): string {
    if (depth > 3) return '...'; // Prevent deep nesting
    
    if (obj === null || obj === undefined) {
      return 'null';
    }
    
    if (typeof obj === 'string') {
      return `string: ${obj.substring(0, 50)}${obj.length > 50 ? '...' : ''}`;
    }
    
    if (typeof obj === 'number') {
      return `number: ${obj}`;
    }
    
    if (typeof obj === 'boolean') {
      return `boolean: ${obj}`;
    }
    
    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return 'array: []';
      }
      return `array: [${this.extractParameters(obj[0], depth + 1)}]`;
    }
    
    if (typeof obj === 'object') {
      let result = '';
      for (const [key, value] of Object.entries(obj)) {
        result += `${'  '.repeat(depth)}- ${key}: ${typeof value}\n`;
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          result += this.extractParameters(value, depth + 1);
        } else if (Array.isArray(value) && value.length > 0) {
          const arrayType = Array.isArray(value[0]) ? 'array' : typeof value[0];
          result += `${'  '.repeat(depth + 1)}[items: ${arrayType}]\n`;
        }
      }
      return result;
    }
    
    return typeof obj;
  }

  /**
   * Expand a query to include related terms to improve matching
   */
  private expandQuery(query: string): string {
    // Define Chinese-English mappings for common API terms
    const termMappings: Record<string, string[]> = {
      'page': ['页面', '分页', '翻页'],
      'create': ['创建', '新建', '增加', '添加'],
      'get': ['获取', '得到', '查询', '查找', '检索'],
      'update': ['更新', '修改', '编辑', '改'],
      'delete': ['删除', '移除', '销毁'],
      'user': ['用户', '使用者', '人员'],
      'order': ['订单', '订购', '次序', '排序'],
      'product': ['产品', '商品', '货物', '制品'],
      'api': ['接口', '接口API', '应用程序接口'],
      'search': ['搜索', '查找', '检索', '查询'],
      'list': ['列表', '清单', '目录', '清单'],
      'detail': ['详情', '细节', '详细信息'],
      'generate': ['生成', '产生', '创建', '制作'],
      'submit': ['提交', '递交', '呈交'],
      'form': ['表单', '表格', '格式'],
      'data': ['数据', '信息', '资料'],
      'info': ['信息', '资讯', '资料'],
      'manage': ['管理', '处理', '操作'],
      'admin': ['管理', '管理员', '管理端'],
      'crud': ['增删改查', 'CRUD', '基本操作']
    };

    const lowerQuery = query.toLowerCase();
    let expandedQuery = query;
    
    // Add Chinese equivalents if the query contains English terms
    for (const [englishTerm, chineseTerms] of Object.entries(termMappings)) {
      if (lowerQuery.includes(englishTerm)) {
        for (const chineseTerm of chineseTerms) {
          expandedQuery += ` ${chineseTerm}`;
        }
      }
    }
    
    // Add English equivalents if the query contains Chinese terms
    for (const [englishTerm, chineseTerms] of Object.entries(termMappings)) {
      for (const chineseTerm of chineseTerms) {
        if (query.includes(chineseTerm)) {
          expandedQuery += ` ${englishTerm}`;
        }
      }
    }
    
    return expandedQuery.toLowerCase();
  }

  /**
   * Extract response fields from a JSON object
   */
  private extractResponseFields(obj: any, depth: number): string {
    if (depth > 3) return '...'; // Prevent deep nesting
    
    if (obj === null || obj === undefined) {
      return 'null';
    }
    
    if (typeof obj === 'string') {
      return `string: ${obj.substring(0, 50)}${obj.length > 50 ? '...' : ''}`;
    }
    
    if (typeof obj === 'number') {
      return `number: ${obj}`;
    }
    
    if (typeof obj === 'boolean') {
      return `boolean: ${obj}`;
    }
    
    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return 'array: []';
      }
      return `array: [${this.extractResponseFields(obj[0], depth + 1)}]`;
    }
    
    if (typeof obj === 'object') {
      let result = '';
      for (const [key, value] of Object.entries(obj)) {
        result += `${'  '.repeat(depth)}- ${key}: ${typeof value}\n`;
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          result += this.extractResponseFields(value, depth + 1);
        } else if (Array.isArray(value) && value.length > 0) {
          const arrayType = Array.isArray(value[0]) ? 'array' : typeof value[0];
          result += `${'  '.repeat(depth + 1)}[items: ${arrayType}]\n`;
        }
      }
      return result;
    }
    
    return typeof obj;
  }
}

/**
 * Implementation of the Query API tool
 * This tool helps discover and retrieve API information from generated documentation.
 * It's particularly useful when building pages or integrating with APIs based on natural language queries,
 * including Chinese queries like "通过xxxApi生成页面" or "查找用户API接口".
 */
export class QueryApiTool extends BaseDeclarativeTool<QueryApiToolParams, ToolResult> {
  static readonly Name: string = ToolNames.QUERY_API;

  constructor(private readonly config: Config) {
    super(
      QueryApiTool.Name,
      'QueryApi',
      'Searches for API information in the generated API documentation files. This tool can find matching interfaces based on search queries and returns fields, field types, and request methods. Useful for discovering API endpoints and their specifications when building pages or integrating with APIs. Input parameters include a query to match API information, with optional filters for specific tags or endpoint paths. Supports both English and Chinese queries for API discovery.',
      Kind.Search,
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query to match API information (e.g., partial endpoint name, operation name, field name, API name in English or Chinese). Use this to find specific API endpoints for page generation or integration.',
          },
          tag: {
            type: 'string',
            description: 'Optional: specific tag to search within (e.g., users-api, products-api, or Chinese API group names)',
          },
          endpoint_path: {
            type: 'string',
            description: 'Optional: specific endpoint path to search for (e.g., /api/users, /v1/products)',
          },
        },
        required: ['query'],
      },
      true, // isOutputMarkdown
      false  // canUpdateOutput
    );
  }

  /**
   * Validates the parameters for the QueryApiTool.
   * @param params The parameters to validate
   * @returns An error message string if validation fails, null if valid
   */
  protected override validateToolParamValues(
    params: QueryApiToolParams,
  ): string | null {
    if (!params.query || params.query.trim() === '') {
      return "The 'query' parameter cannot be empty.";
    }

    if (params.query.length < 2) {
      return "The 'query' parameter should be at least 2 characters long.";
    }

    return null;
  }

  protected createInvocation(
    params: QueryApiToolParams,
  ): ToolInvocation<QueryApiToolParams, ToolResult> {
    return new QueryApiToolInvocation(this.config, params);
  }
}