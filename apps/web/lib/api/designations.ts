import { authorizedRequest, buildQueryString, type PaginatedResult } from './client';

export interface Designation {
  id: string;
  title: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListDesignationsParams {
  page?: number;
  limit?: number;
  search?: string | undefined;
  isActive?: boolean;
}

export interface CreateDesignationInput {
  title: string;
  code?: string | undefined;
  description?: string | undefined;
}

export interface UpdateDesignationInput {
  title?: string;
  code?: string | undefined;
  description?: string | undefined;
}

export function listDesignations(params: ListDesignationsParams = {}): Promise<PaginatedResult<Designation>> {
  return authorizedRequest<PaginatedResult<Designation>>(`/designations${buildQueryString(params)}`);
}

export function getDesignation(id: string): Promise<Designation> {
  return authorizedRequest<Designation>(`/designations/${id}`);
}

export function createDesignation(input: CreateDesignationInput): Promise<Designation> {
  return authorizedRequest<Designation>('/designations', { method: 'POST', body: JSON.stringify(input) });
}

export function updateDesignation(id: string, input: UpdateDesignationInput): Promise<Designation> {
  return authorizedRequest<Designation>(`/designations/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deactivateDesignation(id: string): Promise<Designation> {
  return authorizedRequest<Designation>(`/designations/${id}`, { method: 'DELETE' });
}
