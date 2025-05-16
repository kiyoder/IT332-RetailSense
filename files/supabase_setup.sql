-- Phase 1: Supabase Setup

-- 1. Create profiles table
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  role TEXT DEFAULT 'customer',
  is_profile_complete BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::TEXT, now())
);

-- 2. Enable Row-Level Security (RLS) on profiles table
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 3. Add RLS policy: "Users can view their profile"
CREATE POLICY "Users can view their profile" 
  ON profiles FOR SELECT 
  USING (auth.uid() = id);

-- 4. Add RLS policy: "Users can update their profile"
CREATE POLICY "Users can update their profile" 
  ON profiles FOR UPDATE 
  USING (auth.uid() = id)
  WITH CHECK (username IS NOT NULL AND first_name IS NOT NULL AND last_name IS NOT NULL);

-- 5. Create handle_new_user SQL function for trigger
CREATE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (new.id);
  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- 6. Create on_auth_user_created trigger to call handle_new_user function
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE PROCEDURE handle_new_user();


