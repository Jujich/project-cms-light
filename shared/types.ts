export interface SiteSection { id: string; type: 'hero' | 'services' | 'text' | 'form' | 'custom'; title: string; subtitle?: string; body?: string; buttonText?: string; buttonUrl?: string; image?: string; items?: { id: string; title: string; text: string }[]; fields?: { name: string; label: string; type: 'text' | 'email' | 'tel' | 'textarea'; required?: boolean }[]; html?: string }
export interface SiteContent { name: string; description: string; title: string; accent: string; email: string; phone: string; sections: SiteSection[] }
export interface SiteFiles { 'content.json': string; 'styles.css': string; 'script.js': string; [key: string]: string }
export interface Integration { id: string; type: 'webhook' | 'script'; name: string; enabled: boolean; endpoint?: string; script?: string; secretConfigured?: boolean }
export interface Attachment { id: string; name: string; mime: string; size: number; url: string; text?: string; createdAt: string }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; attachmentIds?: string[]; createdAt: string; runId?: string }
export interface Change { path: string; before: string; after: string }
export interface AgentRun { id: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; stage: string; error?: string; changes: Change[]; createdAt: string; completedAt?: string }
export interface Release { id: string; label: string; createdAt: string; revision: number; files: SiteFiles; integrations: Integration[] }
export interface Submission { id: string; formId: string; data: Record<string, string>; createdAt: string; deliveries?: { integrationId: string; status: string }[] }
export interface Validation { valid: boolean; errors: string[]; warnings: string[] }
export interface Project { id: string; name: string; revision: number; publishedRevision: number; files: SiteFiles; integrations: Integration[]; messages: ChatMessage[]; attachments: Attachment[]; runs: AgentRun[]; releases: Release[]; submissions: Submission[]; updatedAt: string }
export interface AuthStatus { connected: boolean; provider: 'chatgpt' | 'api-key' | null; email?: string; model?: string; error?: string }
export interface Bootstrap { project: Project; auth: AuthStatus; validation: Validation; previewUrl: string; publishedUrl: string }
