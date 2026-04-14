import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://bqhrinjquldltbwmknld.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxaHJpbmpxdWxkbHRid21rbmxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxODMzMDQsImV4cCI6MjA5MTc1OTMwNH0.2__aSqkTlumBljC4nntAgG9ml7_8xOETgajDgoo-ex4'
)
