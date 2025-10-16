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
 * Represents an API method with structured information
 */
interface ApiMethod {
  api_desc: string;
  http_method: string;
  path: string;
  request_params: Record<string, { type: string; description: string }>;
  response_schema: any | null;
}

/**
 * Represents structured API information
 */
interface ApiServiceInfo {
  service_name: string; // Standardized service name from filename
  service_display_name: string; // Display name from file title
  methods: ApiMethod[];
}

/**
 * Parameters for the Query API tool
 * Used to search API documentation for specific endpoints, fields, and methods
 * Supports English and Chinese queries for finding API information
 */
export interface QueryApiToolParams {
  /**
   * Service name to search within (e.g., "group", "order", "user")
   * This is extracted from the filename: e.g., hr分组服务-HrGroupApi.md → "group"
   */
  service_name: string;
  /**
   * Optional: operation keyword to filter specific API methods (e.g., "保存", "分页查询", "create", "list")
   * This matches against the API description to find specific operations
   */
  operation_keyword?: string;
}

/**
 * Cache for parsed API information to avoid re-parsing on every request
 */
class ApiCache {
  private cache: Map<string, ApiServiceInfo[]> = new Map();
  private lastModified: Map<string, number> = new Map();

  get(apiDir: string): ApiServiceInfo[] | null {
    const dirStat = fs.statSync(apiDir);
    const currentModified = dirStat.mtime.getTime();
    
    if (this.lastModified.get(apiDir) === currentModified) {
      return this.cache.get(apiDir) || null;
    }
    return null;
  }

  set(apiDir: string, data: ApiServiceInfo[]): void {
    const dirStat = fs.statSync(apiDir);
    this.lastModified.set(apiDir, dirStat.mtime.getTime());
    this.cache.set(apiDir, data);
  }
}

const apiCache = new ApiCache();

class QueryApiToolInvocation extends BaseToolInvocation<QueryApiToolParams, ToolResult> {
  constructor(
    private readonly config: Config,
    params: QueryApiToolParams,
  ) {
    super(params);
  }

  override getDescription(): string {
    let description = `Querying API information for service: "${this.params.service_name}"`;
    if (this.params.operation_keyword) {
      description += ` with operation keyword: "${this.params.operation_keyword}"`;
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
      const apiFiles = fs.readdirSync(apiDir);

      if (apiFiles.length === 0) {
        return {
          llmContent: `在 ${apiDir} 中未找到API文档文件。请先运行 /apiRefresh 命令生成API文档。\nNo API documentation files found in ${apiDir}. Please run the swagger_api tool first to generate API documentation.`,
          returnDisplay: `No API documentation files found`,
        };
      }

      // Check cache first
      let allServices = apiCache.get(apiDir);
      if (!allServices) {
        allServices = [];
        // Process each API file to build structured data
        for (const file of apiFiles) {
          const filePath = path.join(apiDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          
          // Parse the file to extract API information
          const serviceInfo = this.parseApiFile(file, content);
          if (serviceInfo) {
            allServices.push(serviceInfo);
          }
        }
        
        // Cache the parsed data
        apiCache.set(apiDir, allServices);
      }

      // Find the requested service with improved matching
      const requestedServiceName = this.params.service_name.toLowerCase();
      let serviceInfo = null;
      
      // First try exact match on normalized service name
      serviceInfo = allServices.find(s => s.service_name === requestedServiceName);
      
      // If not found, try matching against display names (original Chinese names)
      if (!serviceInfo) {
        serviceInfo = allServices.find(s => 
          s.service_display_name.toLowerCase().includes(requestedServiceName) ||
          this.normalizeServiceName(s.service_display_name).includes(requestedServiceName)
        );
      }
      
      // If still not found, try more flexible matching including partial Chinese names
      if (!serviceInfo) {
        serviceInfo = allServices.find(s => {
          const displayName = s.service_display_name.toLowerCase();
          // Check if the request is a partial match of the display name
          return displayName.includes(requestedServiceName) || 
                 requestedServiceName.includes(displayName) ||
                 this.isSimilarServiceName(requestedServiceName, displayName);
        });
      }
      
      // If still not found, try keyword-based matching 
      if (!serviceInfo) {
        // Look for keywords that might match service types
        serviceInfo = this.findServiceByKeyword(requestedServiceName, allServices);
      }
      
      if (!serviceInfo) {
        // If service not found, try to suggest similar services based on the original request
        const suggestions = this.findSimilarServices(this.params.service_name, allServices);
        const suggestionText = suggestions.length > 0 
          ? ` Did you mean: ${suggestions.map(s => `"${s.service_name}"`).join(', ')}? Available services: ${allServices.map(s => s.service_name).join(', ')}` 
          : ` Available services: ${allServices.map(s => s.service_name).join(', ')}`;
          
        return {
          llmContent: `未找到服务 "${this.params.service_name}" 的API信息。\nNo API information found for service: "${this.params.service_name}".${suggestionText}`,
          returnDisplay: `Service "${this.params.service_name}" not found`,
        };
      }

      // Filter methods based on the operation keyword if provided
      let methods = serviceInfo.methods;
      if (this.params.operation_keyword) {
        const keyword = this.params.operation_keyword.toLowerCase();
        methods = methods.filter(method => 
          method.api_desc.toLowerCase().includes(keyword) ||
          this.containsChineseKeyword(method.api_desc, this.params.operation_keyword || '')
        );
      }

      if (methods.length === 0) {
        return {
          llmContent: `服务 "${serviceInfo.service_display_name}" 中未找到匹配 "${this.params.operation_keyword}" 的接口。\nNo API methods found matching keyword "${this.params.operation_keyword}" in service "${serviceInfo.service_display_name}". Available methods: ${serviceInfo.methods.map(m => m.api_desc).join(', ')}`,
          returnDisplay: `No matching API methods found`,
        };
      }

      // Format the result for LLM consumption
      const result: ApiServiceInfo = {
        service_name: serviceInfo.service_name,
        service_display_name: serviceInfo.service_display_name,
        methods
      };

      return {
        llmContent: JSON.stringify(result, null, 2),
        returnDisplay: `Found ${methods.length} API method(s) in service "${serviceInfo.service_display_name}"`,
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
   * Parse an API documentation file to extract structured information
   */
  private parseApiFile(filename: string, content: string): ApiServiceInfo | null {
    try {
      // Extract service name from filename (e.g., hr分组服务-HrGroupApi.md → group)
      const serviceName = this.extractServiceNameFromFilename(filename);
      const serviceDisplayName = this.extractServiceDisplayNameFromFilename(filename);
      
      // Extract all API methods from the markdown content
      const methods = this.extractApiMethods(content);
      
      return {
        service_name: serviceName,
        service_display_name: serviceDisplayName,
        methods
      };
    } catch (error) {
      console.error(`Error parsing API file ${filename}:`, error);
      return null;
    }
  }

  /**
   * Extract service name from filename by normalizing it
   */
  private extractServiceNameFromFilename(filename: string): string {
    // Example: hr分组服务-HrGroupApi.md → group
    // First part before the dash contains the service description in Chinese
    const namePart = filename.replace('.md', '').split('-')[0];
    const fullFilename = filename.replace('.md', '');
    
    // If it contains Chinese characters, try to extract a relevant English-like service name
    if (/[^\x00-\x7F]/.test(namePart)) {
      // Match known patterns in Chinese service names
      if (namePart.includes('分组') || namePart.toLowerCase().includes('group')) {
        return 'group';
      } else if (namePart.includes('用户') || namePart.toLowerCase().includes('user')) {
        return 'user';
      } else if (namePart.includes('订单') || namePart.toLowerCase().includes('order')) {
        return 'order';
      } else if (namePart.includes('产品') || namePart.toLowerCase().includes('product')) {
        return 'product';
      } else if (namePart.includes('员工') || namePart.toLowerCase().includes('employee')) {
        return 'employee';
      } else if (namePart.includes('组织') || namePart.toLowerCase().includes('organization')) {
        return 'organization';
      } else if (namePart.includes('部门') || namePart.toLowerCase().includes('department')) {
        return 'department';
      } else if (namePart.includes('权限') || namePart.toLowerCase().includes('permission')) {
        return 'permission';
      } else if (namePart.includes('角色') || namePart.toLowerCase().includes('role')) {
        return 'role';
      } else if (namePart.includes('菜单') || namePart.toLowerCase().includes('menu')) {
        return 'menu';
      } else if (namePart.includes('资源') || namePart.toLowerCase().includes('resource')) {
        return 'resource';
      } else if (namePart.includes('文件') || namePart.toLowerCase().includes('file')) {
        return 'file';
      } else if (namePart.includes('日志') || namePart.toLowerCase().includes('log')) {
        return 'log';
      } else if (namePart.includes('系统') || namePart.toLowerCase().includes('system')) {
        return 'system';
      } else if (namePart.includes('配置') || namePart.toLowerCase().includes('config')) {
        return 'config';
      } else if (namePart.includes('设置') || namePart.toLowerCase().includes('setting')) {
        return 'setting';
      } else if (namePart.includes('字典') || namePart.toLowerCase().includes('dict')) {
        return 'dict';
      } else if (namePart.includes('分类') || namePart.toLowerCase().includes('category')) {
        return 'category';
      } else if (namePart.includes('标签') || namePart.toLowerCase().includes('tag')) {
        return 'tag';
      } else if (namePart.includes('支付') || namePart.toLowerCase().includes('payment')) {
        return 'payment';
      } else if (namePart.includes('购物') || namePart.toLowerCase().includes('cart')) {
        return 'cart';
      } else if (namePart.includes('收藏') || namePart.toLowerCase().includes('favorite')) {
        return 'favorite';
      } else {
        // Fallback: try to get the service name from the second part of the filename (e.g., HrGroupApi)
        const secondPart = fullFilename.split('-')[1] || fullFilename;
        // Extract the service name by looking for common patterns like HrGroupApi -> group
        const serviceMatch = secondPart.match(/([A-Z][a-z]+)Api/i);
        if (serviceMatch) {
          return serviceMatch[1].toLowerCase();
        }
        // If no common pattern found, try to infer from the Chinese name
        return this.inferServiceFromChineseName(namePart);
      }
    } else {
      // If it's already in English, return the lowercase version
      const secondPart = fullFilename.split('-')[1] || fullFilename;
      // Extract the service name by looking for common patterns like HrGroupApi -> group
      const serviceMatch = secondPart.match(/([A-Z][a-z]+)Api/i);
      if (serviceMatch) {
        return serviceMatch[1].toLowerCase();
      }
      return namePart.toLowerCase();
    }
  }

  /**
   * Infer service name from Chinese name using common patterns
   */
  private inferServiceFromChineseName(chineseName: string): string {
    // Extract common service names from Chinese text
    if (chineseName.includes('分组') || chineseName.includes('Group')) {
      return 'group';
    } else if (chineseName.includes('用户') || chineseName.includes('User')) {
      return 'user';
    } else if (chineseName.includes('订单') || chineseName.includes('Order')) {
      return 'order';
    } else if (chineseName.includes('产品') || chineseName.includes('Product')) {
      return 'product';
    } else if (chineseName.includes('员工') || chineseName.includes('Employee')) {
      return 'employee';
    } else if (chineseName.includes('组织') || chineseName.includes('Organization')) {
      return 'organization';
    } else if (chineseName.includes('部门') || chineseName.includes('Department')) {
      return 'department';
    } else if (chineseName.includes('权限') || chineseName.includes('Permission')) {
      return 'permission';
    } else if (chineseName.includes('角色') || chineseName.includes('Role')) {
      return 'role';
    } else {
      // For general cases, just normalize the Chinese name
      return chineseName.replace(/[^\w\s]/gi, '').substring(0, 10).toLowerCase();
    }
  }

  /**
   * Extract display name from filename
   */
  private extractServiceDisplayNameFromFilename(filename: string): string {
    const namePart = filename.replace('.md', '').split('-')[0];
    return namePart;
  }

  /**
   * Normalize service name from display name (for matching purposes)
   */
  private normalizeServiceName(displayName: string): string {
    if (/[^\x00-\x7F]/.test(displayName)) {
      if (displayName.includes('分组') || displayName.includes('group')) {
        return 'group';
      } else if (displayName.includes('用户') || displayName.includes('user')) {
        return 'user';
      } else if (displayName.includes('订单') || displayName.includes('order')) {
        return 'order';
      } else if (displayName.includes('产品') || displayName.includes('product')) {
        return 'product';
      } else if (displayName.includes('员工') || displayName.includes('employee')) {
        return 'employee';
      } else if (displayName.includes('组织') || displayName.includes('organization')) {
        return 'organization';
      } else if (displayName.includes('部门') || displayName.includes('department')) {
        return 'department';
      }
    }
    return displayName.toLowerCase();
  }

  /**
   * Extract all API methods from markdown content
   */
  private extractApiMethods(content: string): ApiMethod[] {
    const methods: ApiMethod[] = [];
    
    // Split content by headings to identify different API operations
    const sections = this.splitMarkdownIntoSections(content);
    
    for (const section of sections) {
      if (section.trim() === '') continue;
      
      const method = this.parseApiMethod(section);
      if (method) {
        methods.push(method);
      }
    }
    
    return methods;
  }

  /**
   * Split markdown content into sections based on headings
   */
  private splitMarkdownIntoSections(content: string): string[] {
    const sections: string[] = [];
    const lines = content.split('\n');
    let currentSection = '';
    
    for (const line of lines) {
      if (line.startsWith('# ')) {
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
   * Parse a single API method section from markdown
   */
  private parseApiMethod(section: string): ApiMethod | null {
    try {
      // Extract API description
      const apiDescMatch = section.match(/# API desc: (.*?)(?:\n|$)/i);
      const apiDesc = apiDescMatch ? apiDescMatch[1].trim() : 'No description';

      // Extract HTTP method
      const methodMatch = section.match(/## Request Type `(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE)`/i);
      const httpMethod = methodMatch ? methodMatch[1].toUpperCase() : 'UNKNOWN';
      
      // Extract path/URL
      const pathMatch = section.match(/## Request URL `([^`]+)`/);
      const path = pathMatch ? pathMatch[1] : 'Unknown Path';
      
      // Extract request parameters from JSON example
      const requestParams = this.extractRequestParameters(section);
      
      // Extract response schema from JSON example
      const responseSchema = this.extractResponseSchema(section);

      return {
        api_desc: apiDesc,
        http_method: httpMethod,
        path,
        request_params: requestParams,
        response_schema: responseSchema
      };
    } catch (error) {
      console.error('Error parsing API method:', error);
      return null;
    }
  }

  /**
   * Extract request parameters from JSON examples in the section
   */
  private extractRequestParameters(section: string): Record<string, { type: string; description: string }> {
    const params: Record<string, { type: string; description: string }> = {};
    
    // Find the request parameters section
    const requestParamStart = section.indexOf('## Request Parameters');
    if (requestParamStart === -1) return params;
    
    const requestParamSection = section.substring(requestParamStart);
    
    // Find JSON block in the request parameters section
    const jsonMatch = requestParamSection.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) return params;
    
    try {
      const jsonStr = jsonMatch[1].trim();
      const exampleObj = JSON.parse(jsonStr);
      
      // Extract fields from the example object
      this.extractFieldsFromExample(exampleObj, params);
    } catch (e) {
      // If JSON parsing fails, try to extract from other content
      console.error('Error parsing request parameters JSON:', e);
    }
    
    return params;
  }

  /**
   * Extract response schema from JSON examples in the section
   */
  private extractResponseSchema(section: string): any {
    // Find the response examples section
    const responseSection = section.substring(section.toLowerCase().indexOf('## response examples'));
    if (responseSection === section) return null; // section not found
    
    // Find JSON block in the response section
    const jsonMatch = responseSection.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) return null;
    
    try {
      const jsonStr = jsonMatch[1].trim();
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error('Error parsing response schema JSON:', e);
      return null;
    }
  }

  /**
   * Extract fields from a JSON example object, including type and description
   */
  private extractFieldsFromExample(obj: any, params: Record<string, { type: string; description: string }>, prefix: string = ''): void {
    if (obj === null || typeof obj !== 'object') return;
    
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        // Nested object - recursively extract fields
        this.extractFieldsFromExample(value, params, fullKey);
      } else {
        // Extract type from the value
        let type = typeof value;
        
        // If it's a string value, try to infer more specific types
        let actualType: string = type;
        if (type === 'string') {
          if (this.isValidEmail(value as string)) {
            actualType = 'email';
          } else if (this.isValidUrl(value as string)) {
            actualType = 'url';
          } else if (this.isValidDate(value as string)) {
            actualType = 'date';
          } else if (this.isValidDateTime(value as string)) {
            actualType = 'datetime';
          }
        } else if (Array.isArray(value)) {
          if (value.length > 0) {
            actualType = `array[${typeof value[0]}]`;
          } else {
            actualType = 'array';
          }
        }
        
        // Extract description from field name if not already present
        let description = params[fullKey]?.description || this.generateDescriptionFromFieldName(key);
        
        params[fullKey] = {
          type: actualType,
          description
        };
      }
    }
  }

  /**
   * Generate description from field name (convert camelCase or snake_case to natural language)
   */
  private generateDescriptionFromFieldName(fieldName: string): string {
    // Replace camelCase with spaces
    let readable = fieldName.replace(/([a-z])([A-Z])/g, '$1 $2');
    // Replace snake_case with spaces
    readable = readable.replace(/_/g, ' ');
    // Capitalize first letter
    readable = readable.charAt(0).toUpperCase() + readable.slice(1);
    return readable;
  }

  /**
   * Check if a string is a valid email
   */
  private isValidEmail(str: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
  }

  /**
   * Check if a string is a valid URL
   */
  private isValidUrl(str: string): boolean {
    try {
      new URL(str);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a string is a valid date (YYYY-MM-DD)
   */
  private isValidDate(str: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(str);
  }

  /**
   * Check if a string is a valid datetime (ISO format)
   */
  private isValidDateTime(str: string): boolean {
    return !isNaN(Date.parse(str));
  }

  /**
   * Check if a Chinese string contains a keyword (for better Chinese matching)
   */
  private containsChineseKeyword(text: string, keyword: string): boolean {
    if (!keyword || !text) return false;
    
    // For Chinese text matching, check if the keyword is contained in the text
    return text.includes(keyword);
  }

  /**
   * Check if two service names are similar enough to be considered a match
   */
  private isSimilarServiceName(requested: string, available: string): boolean {
    // Check for common patterns where user might search for a service
    if (requested.includes('group') && available.includes('group')) return true;
    if (requested.includes('user') && available.includes('user')) return true;
    if (requested.includes('order') && available.includes('order')) return true;
    if (requested.includes('product') && available.includes('product')) return true;
    if (requested.includes('employee') && available.includes('employee')) return true;
    if (requested.includes('organization') && available.includes('organization')) return true;
    
    // For Chinese names - check if they contain similar semantic meaning
    if (requested.includes('分组') && available.includes('分组')) return true;
    if (requested.includes('用户') && available.includes('用户')) return true;
    if (requested.includes('订单') && available.includes('订单')) return true;
    if (requested.includes('产品') && available.includes('产品')) return true;
    if (requested.includes('员工') && available.includes('员工')) return true;
    if (requested.includes('组织') && available.includes('组织')) return true;
    
    return false;
  }

  /**
   * Find service by keyword matching
   */
  private findServiceByKeyword(keyword: string, allServices: ApiServiceInfo[]): ApiServiceInfo | null {
    // Look for services that might match based on keywords
    for (const service of allServices) {
      // Check if the keyword matches common service patterns
      if (this.matchesServiceKeyword(keyword, service.service_name, service.service_display_name)) {
        return service;
      }
    }
    return null;
  }

  /**
   * Check if a keyword matches a service
   */
  private matchesServiceKeyword(keyword: string, serviceName: string, serviceDisplayName: string): boolean {
    const lowerKeyword = keyword.toLowerCase();
    const lowerServiceName = serviceName.toLowerCase();
    const lowerDisplayName = serviceDisplayName.toLowerCase();
    
    // Direct matches
    if (lowerServiceName.includes(lowerKeyword) || lowerKeyword.includes(lowerServiceName)) return true;
    if (lowerDisplayName.includes(lowerKeyword)) return true;
    
    // Semantic matches
    if (lowerKeyword.includes('group') && (lowerServiceName.includes('group') || lowerDisplayName.includes('分组'))) return true;
    if (lowerKeyword.includes('user') && (lowerServiceName.includes('user') || lowerDisplayName.includes('用户'))) return true;
    if (lowerKeyword.includes('order') && (lowerServiceName.includes('order') || lowerDisplayName.includes('订单'))) return true;
    if (lowerKeyword.includes('product') && (lowerServiceName.includes('product') || lowerDisplayName.includes('产品'))) return true;
    if (lowerKeyword.includes('employee') && (lowerServiceName.includes('employee') || lowerDisplayName.includes('员工'))) return true;
    if (lowerKeyword.includes('organization') && (lowerServiceName.includes('organization') || lowerDisplayName.includes('组织'))) return true;
    
    // For Chinese keywords
    if (lowerKeyword.includes('分组') && (lowerServiceName.includes('group') || lowerDisplayName.includes('分组'))) return true;
    if (lowerKeyword.includes('用户') && (lowerServiceName.includes('user') || lowerDisplayName.includes('用户'))) return true;
    if (lowerKeyword.includes('订单') && (lowerServiceName.includes('order') || lowerDisplayName.includes('订单'))) return true;
    if (lowerKeyword.includes('产品') && (lowerServiceName.includes('product') || lowerDisplayName.includes('产品'))) return true;
    if (lowerKeyword.includes('员工') && (lowerServiceName.includes('employee') || lowerDisplayName.includes('员工'))) return true;
    if (lowerKeyword.includes('组织') && (lowerServiceName.includes('organization') || lowerDisplayName.includes('组织'))) return true;
    
    return false;
  }

  /**
   * Find services that are similar to the requested name for suggestions
   */
  private findSimilarServices(requested: string, allServices: ApiServiceInfo[]): ApiServiceInfo[] {
    const similarities = allServices.map(service => {
      let score = 0;
      
      // Score based on service name similarity
      if (service.service_name.toLowerCase().includes(requested.toLowerCase()) || 
          requested.toLowerCase().includes(service.service_name.toLowerCase())) {
        score += 3;
      }
      
      // Score based on display name similarity
      if (service.service_display_name.toLowerCase().includes(requested.toLowerCase())) {
        score += 2;
      }
      
      // Score based on semantic similarity
      if (this.isSimilarServiceName(requested.toLowerCase(), service.service_display_name.toLowerCase())) {
        score += 1;
      }
      
      return { service, score };
    });
    
    // Return top matches (score > 0)
    return similarities
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3) // Return top 3 matches
      .map(item => item.service);
  }
}

const queryApiToolDescription = `
Queries API documentation to find service interfaces and their fields. Use this when you need to list all interfaces in a service (e.g., "list all methods in hr group service") or find specific operations (e.g., "how to save group?", "list group query methods"). The service_name should be a normalized version of the service description from the API documentation file names (e.g., "hr分组服务" maps to "group", "user management" maps to "user").

## When to Use This Tool
Use this tool in the following scenarios:

1. **Service-level queries** - When you need to list all interfaces in a specific service (e.g., "Show all methods in user management service")
2. **Method-level queries** - When you need to find specific operations by keyword (e.g., "Find how to create a user", "Show update operations")
3. **Field-level parsing** - When you need detailed information about request/response fields, types, and examples
4. **Natural language mapping** - When users ask in Chinese or English for specific API functionality

## How to Use This Tool

### Required Parameters:
- **service_name**: The normalized service name (e.g., "group", "user", "order") that maps from documentation file titles like "hr分组服务" -> "group"

### Optional Parameters:
- **operation_keyword**: Keywords to filter specific methods (e.g., "save", "query", "get", "create", "分页查询", "保存", "获取"). Leave empty to list all methods in the service.

## Examples of Usage

<example>
User: "How do I save a group?"
Assistant: Uses QueryApiTool with service_name="group", operation_keyword="save"
Returns: Details about the save group endpoint, required fields, and examples
</example>

<example>
User: "Show all methods in hr分组服务"
Assistant: Uses QueryApiTool with service_name="group" (normalized from hr分组服务), no operation_keyword
Returns: All available methods in the group service
</example>

<example>
User: "What fields are needed for pagination query?"
Assistant: Uses QueryApiTool with service_name="group" and operation_keyword="pagination" or "query"
Returns: Request fields, types, and descriptions for pagination endpoints
</example>

## What This Tool Returns

The tool returns structured JSON with:
- Service information (name, display name)
- Method details (API description, HTTP method, path)
- Request parameters (field names, types, descriptions)
- Response schema (structure and field information)
- Example values for both request and response

When in doubt about API functionality, use this tool to look up the precise interface specifications.
`;

/**
 * Implementation of the Query API tool
 * This tool is designed specifically for LLMs to query API documentation
 * It can identify user intent, automatically query API documentation stored in 
 * path.join(config.storage.getGeminiDir(), 'api'), and return structured field information.
 */
export class QueryApiTool extends BaseDeclarativeTool<QueryApiToolParams, ToolResult> {
  static readonly Name: string = ToolNames.QUERY_API;

  constructor(private readonly config: Config) {
    super(
      QueryApiTool.Name,
      'QueryApi',
      queryApiToolDescription,
      Kind.Search,
      {
        type: 'object',
        properties: {
          service_name: {
            type: 'string',
            description: 'Service name normalized from file titles (e.g., "hr分组服务" -> "group", "用户管理" -> "user", "订单管理" -> "order"). Use simplified names like "group", "user", "order" that represent the core function.',
          },
          operation_keyword: {
            type: 'string',
            description: 'Operation keyword to filter specific methods (e.g., "save", "query", "get", "create", "分页查询", "保存", "获取"). Leave empty to list all methods in the service.',
          }
        },
        required: ['service_name'],
      },
      false, // isOutputMarkdown - return JSON for LLM processing
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
    if (!params.service_name || params.service_name.trim() === '') {
      return "The 'service_name' parameter cannot be empty.";
    }

    if (params.service_name.length < 2) {
      return "The 'service_name' parameter should be at least 2 characters long.";
    }

    return null;
  }

  protected createInvocation(
    params: QueryApiToolParams,
  ): ToolInvocation<QueryApiToolParams, ToolResult> {
    return new QueryApiToolInvocation(this.config, params);
  }
}