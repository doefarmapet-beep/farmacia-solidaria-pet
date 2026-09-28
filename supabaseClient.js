
const SUPABASE_URL = 'https://cacvauixxgjpuhwsaeil.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhY3ZhdWl4eGdqcHVod3NhZWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxNTc1NTksImV4cCI6MjEwNDczMzU1OX0.qXf935SQPylK_4NkYfjWSjFXA8DUOYb6Jf2JbV7GPuU';

// Instância global do cliente Supabase
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);