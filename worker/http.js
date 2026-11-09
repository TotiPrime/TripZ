export const json = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export const error = (message, status) => json({message}, status);
