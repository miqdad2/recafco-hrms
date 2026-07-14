export interface AccessTokenPayload {
  sub: string;
  username: string;
  roles: string[];
  permissions: string[];
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: 'refresh';
}

export interface AuthenticatedUser {
  userId: string;
  username: string;
  roles: string[];
  permissions: string[];
}

export type { RequestContext } from '../../common/request-context.util';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
}
