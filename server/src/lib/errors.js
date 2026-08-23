/** Consistent JSON errors: { error: { code, message } }. */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (m, d) => new AppError(400, 'BAD_REQUEST', m, d);
export const notFound = (m = 'Not found') => new AppError(404, 'NOT_FOUND', m);
export const conflict = (m, d) => new AppError(409, 'CONFLICT', m, d);

/** Wraps an async handler so rejections reach the error middleware. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function notFoundHandler(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', `No route matches ${req.method} ${req.path}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let e = err;
  if (!(e instanceof AppError)) {
    const msg = String(err?.message ?? '');
    if (/UNIQUE constraint failed/i.test(msg)) {
      e = new AppError(409, 'DUPLICATE', 'A record with these values already exists');
    } else if (/FOREIGN KEY constraint failed/i.test(msg)) {
      e = new AppError(409, 'FOREIGN_KEY', 'Referenced record does not exist');
    } else if (/CHECK constraint failed/i.test(msg)) {
      e = new AppError(400, 'INVALID_VALUE', 'A field has a value outside its allowed set');
    } else if (err?.type === 'entity.too.large') {
      e = new AppError(413, 'TOO_LARGE', 'Request body is too large');
    } else if (err instanceof SyntaxError) {
      e = new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON');
    } else {
      e = new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
      console.error('[error]', req.method, req.path, err);
    }
  }
  const body = { error: { code: e.code, message: e.message } };
  if (e.details) body.error.details = e.details;
  res.status(e.status).json(body);
}
