const API_BASE = import.meta.env.VITE_API_BASE_URL 
export async function apiFetch(path, options = {}) 
{   
    console.log("api-base",API_BASE);
    console.log("options",options);
    const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', headers:{
        'Content-Type':'application/json',
        ...options?.headers
    } ,...options}) 
    if (!res.ok) throw new Error(`API error: ${res.status}`) 
    return res.json() 
}