import { authorizedRequest, buildQueryString, type PaginatedResult } from './client';

export interface Department {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListDepartmentsParams {
  page?: number;
  limit?: number;
  search?: string | undefined;
  isActive?: boolean;
}

export interface CreateDepartmentInput {
  name: string;
  code?: string | undefined;
  description?: string | undefined;
}

export interface UpdateDepartmentInput {
  name?: string;
  code?: string | undefined;
  description?: string | undefined;
}

export function listDepartments(params: ListDepartmentsParams = {}): Promise<PaginatedResult<Department>> {
  return authorizedRequest<PaginatedResult<Department>>(`/departments${buildQueryString(params)}`);
}

export function getDepartment(id: string): Promise<Department> {
  return authorizedRequest<Department>(`/departments/${id}`);
}

export function createDepartment(input: CreateDepartmentInput): Promise<Department> {
  return authorizedRequest<Department>('/departments', { method: 'POST', body: JSON.stringify(input) });
}

export function updateDepartment(id: string, input: UpdateDepartmentInput): Promise<Department> {
  return authorizedRequest<Department>(`/departments/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deactivateDepartment(id: string): Promise<Department> {
  return authorizedRequest<Department>(`/departments/${id}`, { method: 'DELETE' });
}
