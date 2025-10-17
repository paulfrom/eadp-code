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
   * Must not contain spaces or special characters except hyphens and underscores.
   * Valid characters: alphanumeric characters, hyphens, underscores, and Chinese characters.
   * Invalid characters: spaces, < > : " | ? * and other special characters.
   */
  service_name: string;
  /**
   * Optional: operation keyword to filter specific API methods (e.g., "保存", "分页查询", "create", "list")
   * This matches against the API description to find specific operations
   * Must not contain special characters that could cause security issues.
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

  /**
   * Checks if a path is within the root directory and resolves it.
   * @param relativePath Path relative to the root directory (or undefined for root).
   * @returns The absolute path if valid and exists, or null if no path specified (to search all directories).
   * @throws {Error} If path is outside root, doesn't exist, or isn't a directory.
   */
  private resolveAndValidatePath(relativePath?: string): string | null {
    // If no path specified, return null to indicate searching all workspace directories
    if (!relativePath) {
      return null;
    }

    const targetPath = path.resolve(this.config.storage.getGeminiDir(), relativePath);

    // Check existence and type after resolving
    try {
      const stats = fs.statSync(targetPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${targetPath}`);
      }
    } catch (error: unknown) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOENT') {
        throw new Error(`Path does not exist: ${targetPath}`);
      }
      throw new Error(
        `Failed to access path stats for ${targetPath}: ${error}`,
      );
    }

    return targetPath;
  }

  async execute(): Promise<ToolResult> {
    try {
      // Get the API directory path with validation
      const apiDir = path.join(this.config.storage.getGeminiDir(), 'api');
      
      // Validate API directory path
      try {
        this.resolveAndValidatePath('api');
      } catch (error) {
        return {
          llmContent: `API目录验证失败: ${(error as Error).message}\nAPI directory validation failed: ${(error as Error).message}`,
          returnDisplay: `API directory validation failed`,
        };
      }
      
      if (!fs.existsSync(apiDir)) {
        return {
          llmContent: `未找到API文档目录 ${apiDir}。请先运行 /apiRefresh 命令生成API文档。\nNo API documentation directory found at ${apiDir}. Please run the swagger_api tool first to generate API documentation.`,
          returnDisplay: `API documentation directory not found`,
        };
      }

      // Get all API documentation files
      let apiFiles: string[] = [];
      try {
        apiFiles = fs.readdirSync(apiDir);
      } catch (error) {
        return {
          llmContent: `无法读取API文档目录 ${apiDir}。错误: ${(error as Error).message}\nCannot read API documentation directory ${apiDir}. Error: ${(error as Error).message}`,
          returnDisplay: `Cannot read API documentation directory`,
        };
      }

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
          try {
            const filePath = path.join(apiDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            
            // Parse the file to extract API information
            const serviceInfo = this.parseApiFile(file, content);
            if (serviceInfo) {
              allServices.push(serviceInfo);
            }
          } catch (error) {
            console.warn(`Warning: Failed to parse API file ${file}:`, error);
            // Continue with other files even if one fails
            continue;
          }
        }
        
        // Cache the parsed data
        apiCache.set(apiDir, allServices);
      }

      // Find the requested service with enhanced matching that identifies multiple possible matches
      // and returns the one with the highest match score
      const requestedServiceName = this.params.service_name.toLowerCase();
      
      // Check if this is a pattern-based query (e.g., '\s+Api', '\s+服务', '\s+接口')
      const isPatternQuery = requestedServiceName.includes('\\s+') || 
                             requestedServiceName === 'api' || 
                             requestedServiceName === '服务' || 
                             requestedServiceName === '接口';
      
      // Check if this is a multi-term query with | separator
      const hasMultipleTerms = requestedServiceName.includes('|');
      
      if (isPatternQuery) {
        // For pattern queries, return all services that match the pattern
        const matchingServices = this.findAllServicesMatchingPattern(requestedServiceName, allServices);
        if (matchingServices.length > 0) {
          // Create a combined result with all matching services
          const combinedResult: ApiServiceInfo = {
            service_name: `pattern_match_${requestedServiceName}`,
            service_display_name: `Services matching pattern: ${requestedServiceName}`,
            methods: matchingServices.flatMap(service => service.methods)
          };
          
          // Limit results for performance (similar to ripGrep's approach)
          const MAX_RESULTS = 20000;
          const wasTruncated = combinedResult.methods.length > MAX_RESULTS;
          if (wasTruncated) {
            combinedResult.methods = combinedResult.methods.slice(0, MAX_RESULTS);
          }
          
          let llmContent = JSON.stringify(combinedResult, null, 2);
          if (wasTruncated) {
            llmContent += `\n\n注: 结果已被截断，仅显示前${MAX_RESULTS}个方法以提高性能。\nNote: Results were truncated, showing only the first ${MAX_RESULTS} methods for performance.`;
          }
          
          let returnDisplay = `Found ${matchingServices.length} service(s) matching pattern "${requestedServiceName}"`;
          if (wasTruncated) {
            returnDisplay += ` (limited to ${MAX_RESULTS} methods)`;
          }
          
          return {
            llmContent,
            returnDisplay,
          };
        } else {
          // If no services match the pattern, return an appropriate message
          const availableServices = allServices.map(s => s.service_name).join(', ');
          return {
            llmContent: `未找到匹配模式 "${requestedServiceName}" 的服务。\nNo services found matching pattern: "${requestedServiceName}". Available services: ${availableServices}`,
            returnDisplay: `No services found matching pattern "${requestedServiceName}"`,
          };
        }
      }
      
      // Handle multi-term queries (terms separated by |)
      let serviceTerms: string[] = [];
      if (hasMultipleTerms) {
        // Split by | and trim whitespace
        serviceTerms = requestedServiceName.split('|').map(term => term.trim()).filter(term => term.length > 0);
      } else {
        serviceTerms = [requestedServiceName];
      }
      
      // Try to find a service that matches any of the provided terms
      let serviceInfo = null;
      
      // First, try exact matches for any term
      for (const term of serviceTerms) {
        const exactMatch = allServices.find(service => 
          service.service_name.toLowerCase() === term.toLowerCase() || 
          service.service_display_name.toLowerCase() === term.toLowerCase()
        );
        if (exactMatch) {
          serviceInfo = exactMatch;
          break;
        }
      }
      
      // If no exact match, try fuzzy matching for each term
      if (!serviceInfo) {
        let bestMatchScore = 0;
        for (const term of serviceTerms) {
          // Generate possible service name interpretations for this term
          const possibleServiceNames = this.generatePossibleServiceNames(term);
          
          // Check all services against all possible interpretations of this term
          for (const service of allServices) {
            for (const possibleName of possibleServiceNames) {
              const score = this.calculateServiceMatchScore(possibleName, service);
              if (score > bestMatchScore) {
                bestMatchScore = score;
                serviceInfo = service;
              }
            }
          }
        }
      // If we still don't have a service match, try to suggest similar services based on any of the terms
        // If service not found, try to suggest similar services based on the original request
        const suggestions = this.findSimilarServices(this.params.service_name, allServices);
        const suggestionText = suggestions.length > 0 
          ? ` Did you mean: ${suggestions.map(s => `"${s.service_name}"`).join(', ')}?` 
          : '';
        const availableServices = allServices.map(s => s.service_name).join(', ');
          
        return {
          llmContent: `未找到服务 "${this.params.service_name}" 的API信息。\nNo API information found for service: "${this.params.service_name}".${suggestionText} Available services: ${availableServices}`,
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
        const availableMethods = serviceInfo.methods.map(m => m.api_desc).join(', ');
        return {
          llmContent: `服务 "${serviceInfo.service_display_name}" 中未找到匹配 "${this.params.operation_keyword}" 的接口。\nNo API methods found matching keyword "${this.params.operation_keyword}" in service "${serviceInfo.service_display_name}". Available methods: ${availableMethods}`,
          returnDisplay: `No matching API methods found`,
        };
      }

      // Format the result for LLM consumption with performance limits (similar to ripGrep)
      const MAX_RESULTS = 20000;
      const wasTruncated = methods.length > MAX_RESULTS;
      if (wasTruncated) {
        methods = methods.slice(0, MAX_RESULTS);
      }
      
      const result: ApiServiceInfo = {
        service_name: serviceInfo.service_name,
        service_display_name: serviceInfo.service_display_name,
        methods
      };

      let llmContent = JSON.stringify(result, null, 2);
      if (wasTruncated) {
        llmContent += `\n\n注: 结果已被截断，仅显示前${MAX_RESULTS}个方法以提高性能。\nNote: Results were truncated, showing only the first ${MAX_RESULTS} methods for performance.`;
      }
      
      let returnDisplay = `Found ${methods.length} API method(s) in service "${serviceInfo.service_display_name}"`;
      if (wasTruncated) {
        returnDisplay += ` (limited to ${MAX_RESULTS} methods)`;
      }

      return {
        llmContent,
        returnDisplay,
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
    
    // Try to get the service name from the second part of the filename (e.g., HrGroupApi)
    const secondPart = fullFilename.split('-')[1] || fullFilename;
    
    // Extract the service name by looking for common patterns like HrGroupApi -> group
    // Handle various API suffix patterns
    const serviceMatch = secondPart.match(/([A-Z][a-z]+)(?:Api|Service|Controller|Interface|Endpoint|Rest)/i);
    if (serviceMatch) {
      return serviceMatch[1].toLowerCase();
    }
    
    // Handle more complex patterns with suffixes like HrGroupApiService -> group
    const complexMatch = secondPart.match(/(?:[A-Z][a-z]+)*([A-Z][a-z]+)(?:Api|Service|Controller|Interface|Endpoint|Rest)[A-Z][a-z]*/i);
    if (complexMatch) {
      return complexMatch[1].toLowerCase();
    }
    
    // Fallback to using the original name part if no API pattern is found
    // but normalize by removing special characters and taking first part if it contains multiple words
    const normalized = namePart.replace(/[^\w\s]/gi, ' ').trim();
    const firstWord = normalized.split(/\s+/)[0];
    return firstWord.toLowerCase();
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
   * Calculate match score for a service based on the requested service name
   */
  private calculateServiceMatchScore(requested: string, service: ApiServiceInfo): number {
    let score = 0;
    
    const serviceDisplayName = service.service_display_name.toLowerCase();
    const serviceName = service.service_name.toLowerCase();
    const requestedLower = requested.toLowerCase();
    
    // Check if the requested pattern is a regex pattern that should match the service name structure
    if (this.isRegexPatternMatch(requestedLower, serviceDisplayName, serviceName)) {
      return 90; // High score for pattern matches
    }
    
    // Exact match - highest score
    if (serviceName === requestedLower || serviceDisplayName === requestedLower) {
      return 100;
    }
    
    // Service name similarity - high score
    if (serviceName.includes(requestedLower) || requestedLower.includes(serviceName)) {
      score += 25;
    }
    
    // Display name similarity - high score
    if (serviceDisplayName.includes(requestedLower) || requestedLower.includes(serviceDisplayName)) {
      score += 20;
    }
    
    // Partial matching with normalization - medium score
    if (this.normalizeServiceName(service.service_display_name).includes(requestedLower) ||
        requestedLower.includes(this.normalizeServiceName(service.service_display_name))) {
      score += 15;
    }
    
    // Semantic similarity checks - medium to low score
    if (this.isSimilarServiceName(requestedLower, serviceDisplayName)) {
      score += 12;
    }
    
    // Additional semantic checks based on common patterns
    if (this.matchesServiceKeyword(requestedLower, serviceName, serviceDisplayName)) {
      score += 10;
    }
    
    // Check if service display name contains parts of requested name or vice versa
    const requestedWords = requestedLower.split(/[\s\-_]+/);
    const displayNameWords = serviceDisplayName.split(/[\s\-_]+/);
    
    // Add points for each matching word
    for (const reqWord of requestedWords) {
      if (reqWord.length > 1) { // Only consider meaningful words
        for (const dispWord of displayNameWords) {
          if (dispWord.includes(reqWord) || reqWord.includes(dispWord)) {
            score += 3;
          }
        }
      }
    }
    
    
    // Enhanced matching for common service patterns (e.g., "user api" matching "user")
    if (this.hasCommonServicePatternMatch(requestedLower, serviceDisplayName)) {
      score += 7;
    }
    
    // Check for common abbreviations
    if (this.hasAbbreviationMatch(requestedLower, serviceName)) {
      score += 5;
    }
    
    // Deduct points for services that are too different in length (avoid very short matches in long names)
    const lengthDiff = Math.abs(requestedLower.length - serviceDisplayName.length);
    if (lengthDiff > 20) {
      score = Math.max(0, score - Math.floor(lengthDiff / 5));
    }
    
    return score;
  }

  /**
   * Check for common service pattern matches (e.g., "user api" matching "user")
   */
  private hasCommonServicePatternMatch(requested: string, displayName: string): boolean {
    // Remove common suffixes like "api", "service", "management" etc. from both
    const cleanRequested = requested
      .replace(/\b(api|service|svc|management|mgr|system|app|web|interface|module|endpoint|rest|controller)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
      
    const cleanDisplayName = displayName
      .replace(/\b(api|service|svc|management|mgr|system|app|web|interface|module|endpoint|rest|controller)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    // If cleaned versions match, it's a pattern match
    if (cleanRequested && cleanDisplayName && 
        (cleanRequested.includes(cleanDisplayName) || cleanDisplayName.includes(cleanRequested))) {
      return true;
    }
    
    return false;
  }

  /**
   * Check for abbreviation matches (e.g., "usr" matching "user")
   */
  private hasAbbreviationMatch(requested: string, serviceName: string): boolean {
    // Common abbreviations mapping
    const abbreviations: [string, string[]][] = [
      ['usr', ['user']],
      ['emp', ['employee']],
      ['org', ['organization']],
      ['dept', ['department']],
      ['prod', ['product']],
      ['ord', ['order']],
      ['auth', ['auth', 'authorization', 'permission']],
      ['grp', ['group']],
      ['cfg', ['config', 'configuration']],
      ['acct', ['account']],
      ['cust', ['customer']],
      ['inv', ['inventory', 'invoice']],
      ['pay', ['payment', 'pay']],
      ['msg', ['message']],
      ['not', ['notification']],
      ['cal', ['calendar']],
      ['evt', ['event']],
      ['tag', ['tag']],
      ['cat', ['category']]
    ];

    // Check if requested is an abbreviation of the service name
    for (const [abbrev, fullForms] of abbreviations) {
      if (requested === abbrev && fullForms.some(full => serviceName.includes(full))) {
        return true;
      }
      
      // Check if service name is an abbreviation of requested
      if (serviceName === abbrev && fullForms.some(full => requested.includes(full))) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check if the requested pattern is a regex pattern that should match service name structures
   * Handles patterns like '\s+Api', '\s+服务', '\s+接口'
   */
  private isRegexPatternMatch(requested: string, serviceDisplayName: string, serviceName: string): boolean {
    // Check if the requested string is a regex pattern for common service name structures
    try {
      // Handle specific regex patterns that match common service naming conventions
      if (requested === '\\s+api' || requested === 'api') {
        // Match services that end with 'Api' (case insensitive)
        return /api$/i.test(serviceName) || /api/i.test(serviceDisplayName) || /api$/i.test(serviceName);
      }
      
      if (requested === '\\s+服务' || requested === '服务') {
        // Match services that contain '服务' in their display name
        return serviceDisplayName.includes('服务');
      }
      
      if (requested === '\\s+接口' || requested === '接口') {
        // Match services that contain '接口' in their display name
        return serviceDisplayName.includes('接口');
      }
      
      // Handle general regex patterns that might be checking for suffixes
      if (requested.includes('\\s+') && requested.includes('api')) {
        // Pattern like '\s+Api' - check if service name ends with 'Api'
        return /api$/i.test(serviceName);
      }
      
      if (requested.includes('\\s+') && requested.includes('服务')) {
        // Pattern like '\s+服务' - check if service display name contains '服务'
        return serviceDisplayName.includes('服务');
      }
      
      if (requested.includes('\\s+') && requested.includes('接口')) {
        // Pattern like '\s+接口' - check if service display name contains '接口'
        return serviceDisplayName.includes('接口');
      }
      
      // Try to parse as a literal regex pattern if it starts and ends with '/'
      if (requested.startsWith('/') && requested.endsWith('/')) {
        const pattern = requested.slice(1, -1);
        const regex = new RegExp(pattern, 'i');
        return regex.test(serviceName) || regex.test(serviceDisplayName);
      }
    } catch (e) {
      // If regex parsing fails, continue with normal matching
      console.debug(`Failed to parse regex pattern: ${requested}`, e);
    }
    
    return false;
  }

  /**
   * Generate multiple possible service name interpretations for flexible matching
   */
  private generatePossibleServiceNames(requested: string): string[] {
    const possibleNames = [requested]; // Start with the original requested name
    
    // Add variations by removing common service-related suffixes
    const suffixesToRemove = [
      'service', 'svc', 'api', 'management', 'mgr', 'controller', 
      '服务', '接口', '管理', '控制器', 'api接口'
    ];
    
    for (const suffix of suffixesToRemove) {
      if (requested.endsWith(suffix)) {
        const variation = requested.substring(0, requested.length - suffix.length).trim();
        if (variation && !possibleNames.includes(variation)) {
          possibleNames.push(variation);
        }
      }
    }
    
    // Add variations by removing common service-related prefixes
    const prefixesToRemove = [
      'crm', 'com_', 'api_', 'service_', 'svc_'
    ];
    
    for (const prefix of prefixesToRemove) {
      if (requested.startsWith(prefix)) {
        const variation = requested.substring(prefix.length).trim();
        if (variation && !possibleNames.includes(variation)) {
          possibleNames.push(variation);
        }
      }
    }
    
    // Add variations by splitting on common separators and taking parts
    if (requested.includes(' ')) {
      const parts = requested.split(/\s+/);
      for (const part of parts) {
        if (part && !possibleNames.includes(part)) {
          possibleNames.push(part);
        }
      }
    }
    
    if (requested.includes('-')) {
      const parts = requested.split('-');
      for (const part of parts) {
        if (part && !possibleNames.includes(part)) {
          possibleNames.push(part);
        }
      }
    }
    
    if (requested.includes('_')) {
      const parts = requested.split('_');
      for (const part of parts) {
        if (part && !possibleNames.includes(part)) {
          possibleNames.push(part);
        }
      }
    }
    
    // Add common abbreviations/expansions
    const commonMappings: [string, string][] = [
      ['customer', 'cust'],
      ['customer', 'crm'],
      ['project', 'proj'],
      ['employee', 'emp'],
      ['organization', 'org'],
      ['department', 'dept'],
      ['application', 'app'],
      ['information', 'info'],
      ['document', 'doc'],
      ['contract', 'contract'],
      ['product', 'prod'],
      ['order', 'ord'],
      ['payment', 'pay'],
      ['purchase', 'buy'],
      ['report', 'rep'],
      ['data', 'dt'],
      ['service', 'svc'],
      ['group', 'grp'],
      ['user', 'usr'],
      ['config', 'cfg']
    ];
    
    for (const [full, abbrev] of commonMappings) {
      if (requested.includes(full)) {
        const variation = requested.replace(new RegExp(full, 'g'), abbrev);
        if (!possibleNames.includes(variation)) {
          possibleNames.push(variation);
        }
      } else if (requested.includes(abbrev)) {
        const variation = requested.replace(new RegExp(abbrev, 'g'), full);
        if (!possibleNames.includes(variation)) {
          possibleNames.push(variation);
        }
      }
    }
    
    return possibleNames;
  }

  /**
   * Find all services that match a specific pattern
   */
  private findAllServicesMatchingPattern(pattern: string, allServices: ApiServiceInfo[]): ApiServiceInfo[] {
    // Special case: if pattern is requesting all API services, return services ending with Api
    if (pattern === '\\s+api' || pattern === 'api') {
      return allServices.filter(service => 
        /api$/i.test(service.service_name) || 
        service.service_name.toLowerCase().includes('api')
      );
    }
    
    // Special case: if pattern is requesting all services with '服务' in display name
    if (pattern === '\\s+服务' || pattern === '服务') {
      return allServices.filter(service => 
        service.service_display_name.includes('服务')
      );
    }
    
    // Special case: if pattern is requesting all services with '接口' in display name
    if (pattern === '\\s+接口' || pattern === '接口') {
      return allServices.filter(service => 
        service.service_display_name.includes('接口')
      );
    }
    
    // For general pattern matching, check if any service matches
    return allServices.filter(service => 
      this.isRegexPatternMatch(pattern, service.service_display_name, service.service_name)
    );
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
Queries API documentation to find service interfaces and their fields. This is the PRIMARY tool for confirming API functionality and should be used whenever you need to verify API endpoints, request/response structures, or field definitions. It helps identify the exact input fields required for API requests and the structure of API responses.

Use this when you need to determine:
- Input fields required to create or update data (e.g., "What fields do I need to create a customer?")
- API endpoints for specific operations (e.g., "How to save a project?")
- Response structure from API calls (e.g., "What data comes back from customer query?")
- Complete API specifications before implementing any API integration

The service_name should be a normalized version of the service description from the API documentation file names (e.g., "hr分组服务-HrGroupApi.md" → "group", "客户拜访-CrmCustomerVisitApi.md" → "customer"). Service names must not contain spaces or special characters except hyphens and underscores. Valid characters: alphanumeric characters, hyphens, underscores, and Chinese characters. Invalid characters: spaces, < > : " | ? * and other special characters.

You can also use regex patterns to match multiple services:
- "\\s+Api" - Matches all services with "Api" suffix
- "\\s+服务" - Matches all services with "服务" in the display name
- "\\s+接口" - Matches all services with "接口" in the display name
- "user|employee|staff" - Matches services containing any of these terms

## When to Use This Tool (PRIORITY 1)
This is the first tool to use when confirming any API functionality. Use this tool in the following scenarios:

1. **API verification (Primary Use)** - Always check API availability and structure FIRST before implementing any API integration
2. **Frontend form development** - When you need to know what fields to include in forms or data entry pages
3. **API integration** - When implementing API calls to determine request/response structure 
4. **Service-level queries** - When you need to list all interfaces in a specific service (e.g., "Show all methods in customer service")
5. **Method-level queries** - When you need to find specific operations by keyword (e.g., "Find customer search method")
6. **Field-level parsing** - When you need detailed field information for frontend validation or display

## How to Use This Tool

### Required Parameters:
- **service_name**: The normalized service name (e.g., "customer", "project", "contract") that maps from documentation file titles like "客户拜访-CrmCustomerVisitApi.md" -> "customer"
  You can also provide multiple related terms separated by | (e.g., "user|employee", "客户|customer|客戶", "groupApi|分组服务|group接口")

### Optional Parameters:
- **operation_keyword**: Keywords to filter specific methods (e.g., "save", "query", "get", "create", "search", "分页查询", "保存", "获取"). Leave empty to list all methods in the service.

## Examples of Usage

<example>
User: "I need to build a customer creation form. What fields do I need?"
Assistant: Uses QueryApiTool with service_name="customer", operation_keyword="create"
Returns: All required and optional fields for customer creation API
</example>

<example>
User: "How do I retrieve customer information?"
Assistant: Uses QueryApiTool with service_name="customer", operation_keyword="get"
Returns: Details about customer retrieval endpoint, required fields, and response structure
</example>

<example>
User: "Show all methods in 客户拜访 service"
Assistant: Uses QueryApiTool with service_name="customer" (normalized from 客户拜访), no operation_keyword  
Returns: All available methods in the customer service
</example>

<example>
User: "What fields do I need to submit for a project?"
Assistant: Uses QueryApiTool with service_name="project" and operation_keyword="submit"
Returns: Request fields, types, and descriptions for project submission endpoints
</example>

<example>
User: "Find the user management API"
Assistant: Uses QueryApiTool with service_name="user|employee|staff"  
Returns: Services matching any of these terms
</example>

<example>
User: "How to work with customers in Chinese?"
Assistant: Uses QueryApiTool with service_name="客户|customer|客戶"  
Returns: Services matching any of these translation terms
</example>

## What This Tool Returns

The tool returns structured JSON with:
- Service information (name, display name)
- Method details (API description, HTTP method, path)
- Request parameters (field names, types, descriptions) - critical for frontend form building
- Response schema (structure and field information) - important for frontend data handling
- Example values for both request and response

IMPORTANT: This is the primary and preferred tool for confirming any API functionality. Always use this tool first when you need to verify API endpoints, parameters, or response structures before implementing any API integration.

Total results are limited to 20,000 matches for performance, similar to ripGrep.
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
            description: "Service name to search within (e.g., \"group\", \"order\", \"user\") or regex pattern to match service structures (e.g., \"\\s+Api\", \"\\s+服务\", \"\\s+接口\"). This is extracted from the filename: e.g., hr分组服务-HrGroupApi.md → \"group\". Service names must not contain spaces or special characters except hyphens and underscores. Valid characters: alphanumeric characters, hyphens, underscores, and Chinese characters. Invalid characters: spaces, < > : \" | ? * and other special characters.",
          },
          operation_keyword: {
            type: 'string',
            description: 'Operation keyword to filter specific methods (e.g., "save", "query", "get", "create", "分页查询", "保存", "获取", "更新"). Leave empty to list all methods in the service.',
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

    // Validate that the service name doesn't contain dangerous characters
    if (/[<>:"|?*]/.test(params.service_name)) {
      return "The 'service_name' parameter contains invalid characters.";
    }
    
    // Explicitly prevent spaces and other special characters that could cause issues
    // Allow only alphanumeric characters, hyphens, underscores, and Chinese characters
    if (/[^a-zA-Z0-9\u4e00-\u9fa5\-_]/.test(params.service_name)) {
      return "The 'service_name' parameter contains invalid characters. Only alphanumeric characters, hyphens, underscores, and Chinese characters are allowed. Spaces and other special characters are not permitted.";
    }

    return null;
  }

  protected createInvocation(
    params: QueryApiToolParams,
  ): ToolInvocation<QueryApiToolParams, ToolResult> {
    return new QueryApiToolInvocation(this.config, params);
  }
}