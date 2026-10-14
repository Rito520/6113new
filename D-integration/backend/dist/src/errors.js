import { ZodError } from 'zod';
export class ApiError extends Error {
    status;
    code;
    details;
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
export const notFoundHandler = (_request, _response, next) => {
    next(new ApiError(404, 'ROUTE_NOT_FOUND', 'The requested API route does not exist.'));
};
export const errorHandler = (error, _request, response, _next) => {
    if (error instanceof ZodError) {
        response.status(400).json({
            error: {
                code: 'VALIDATION_ERROR',
                message: 'The request data is invalid.',
                details: error.issues,
            },
        });
        return;
    }
    if (error instanceof ApiError) {
        response.status(error.status).json({
            error: { code: error.code, message: error.message, details: error.details },
        });
        return;
    }
    console.error(error);
    response.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' },
    });
};
//# sourceMappingURL=errors.js.map