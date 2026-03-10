-- Add assigned_waiter_id to tables table
ALTER TABLE public.tables 
ADD COLUMN assigned_waiter_id uuid REFERENCES public.staff_users(id) ON DELETE SET NULL DEFAULT NULL;

-- Add name column to staff_users if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'staff_users' AND column_name = 'name') THEN
    ALTER TABLE public.staff_users ADD COLUMN name text;
  END IF;
END $$;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_tables_assigned_waiter_id ON public.tables(assigned_waiter_id);
