import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    authUserId?: string;
    adminPrincipal?: import('../services/admin-auth.js').AdminPrincipal;
  }
}
