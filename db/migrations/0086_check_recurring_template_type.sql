-- Lets a recurring template materialize a Check, same as 'deposit'/'expense'.
ALTER TYPE recurring_template_type ADD VALUE IF NOT EXISTS 'check';
