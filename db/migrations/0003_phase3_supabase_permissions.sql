-- Realtime and Storage are Supabase-managed schemas. These guarded policy
-- additions are a no-op on plain PostgreSQL/local test databases where those
-- schemas do not exist.

DO $migration$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'realtime'
        AND tablename = 'messages'
        AND policyname = 'sehir_staff_receive_restaurant_broadcasts'
    ) THEN
      EXECUTE $policy$
        CREATE POLICY "sehir_staff_receive_restaurant_broadcasts"
        ON "realtime"."messages"
        FOR SELECT
        TO authenticated
        USING (
          "extension" = 'broadcast'
          AND EXISTS (
            SELECT 1
            FROM public.staff_profiles AS membership
            INNER JOIN public.restaurants AS active_restaurant
              ON active_restaurant.id = membership.restaurant_id
             AND active_restaurant.is_active
            WHERE membership.auth_user_id = (SELECT auth.uid())
              AND membership.is_active
              AND membership.deleted_at IS NULL
              AND (
                (SELECT realtime.topic()) =
                  'restaurant:' || membership.restaurant_id::text
                OR (SELECT realtime.topic()) LIKE
                  'restaurant:' || membership.restaurant_id::text || ':%'
              )
          )
        )
      $policy$;
    END IF;
  END IF;
END
$migration$;--> statement-breakpoint

-- Product image objects live at:
--   <restaurant UUID>/products/<product UUID>/original.<safe extension>
-- The bucket itself must be created as PUBLIC through the Storage API or
-- Dashboard. Public object delivery then bypasses object SELECT RLS as designed,
-- while listing metadata and every write remain protected below. No anonymous
-- INSERT/UPDATE/DELETE or bucket-list policy is created.
DO $migration$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname = 'sehir_product_images_admin_select'
    ) THEN
      EXECUTE $policy$
        CREATE POLICY "sehir_product_images_admin_select"
        ON "storage"."objects"
        FOR SELECT
        TO authenticated
        USING (
          bucket_id = 'product-images'
          AND EXISTS (
            SELECT 1
            FROM public.staff_profiles AS membership
            INNER JOIN public.restaurants AS active_restaurant
              ON active_restaurant.id = membership.restaurant_id
             AND active_restaurant.is_active
            WHERE membership.auth_user_id = (SELECT auth.uid())
              AND membership.role IN ('ADMIN', 'MANAGER')
              AND membership.is_active
              AND membership.deleted_at IS NULL
              AND (storage.foldername(storage.objects.name))[1] = membership.restaurant_id::text
              AND (storage.foldername(storage.objects.name))[2] = 'products'
          )
        )
      $policy$;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname = 'sehir_product_images_admin_insert'
    ) THEN
      EXECUTE $policy$
        CREATE POLICY "sehir_product_images_admin_insert"
        ON "storage"."objects"
        FOR INSERT
        TO authenticated
        WITH CHECK (
          bucket_id = 'product-images'
          AND storage.objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/products/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/original[.](avif|jpg|png|webp)$'
          AND EXISTS (
            SELECT 1
            FROM public.staff_profiles AS membership
            INNER JOIN public.restaurants AS active_restaurant
              ON active_restaurant.id = membership.restaurant_id
             AND active_restaurant.is_active
            WHERE membership.auth_user_id = (SELECT auth.uid())
              AND membership.role IN ('ADMIN', 'MANAGER')
              AND membership.is_active
              AND membership.deleted_at IS NULL
              AND (storage.foldername(storage.objects.name))[1] = membership.restaurant_id::text
          )
        )
      $policy$;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname = 'sehir_product_images_admin_update'
    ) THEN
      EXECUTE $policy$
        CREATE POLICY "sehir_product_images_admin_update"
        ON "storage"."objects"
        FOR UPDATE
        TO authenticated
        USING (
          bucket_id = 'product-images'
          AND EXISTS (
            SELECT 1 FROM public.staff_profiles AS membership
            WHERE membership.auth_user_id = (SELECT auth.uid())
              AND membership.role IN ('ADMIN', 'MANAGER')
              AND membership.is_active AND membership.deleted_at IS NULL
              AND (storage.foldername(storage.objects.name))[1] = membership.restaurant_id::text
              AND EXISTS (
                SELECT 1 FROM public.restaurants AS active_restaurant
                WHERE active_restaurant.id = membership.restaurant_id
                  AND active_restaurant.is_active
              )
          )
        )
        WITH CHECK (
          bucket_id = 'product-images'
          AND storage.objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/products/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/original[.](avif|jpg|png|webp)$'
          AND EXISTS (
            SELECT 1 FROM public.staff_profiles AS membership
            WHERE membership.auth_user_id = (SELECT auth.uid())
              AND membership.role IN ('ADMIN', 'MANAGER')
              AND membership.is_active AND membership.deleted_at IS NULL
              AND (storage.foldername(storage.objects.name))[1] = membership.restaurant_id::text
              AND EXISTS (
                SELECT 1 FROM public.restaurants AS active_restaurant
                WHERE active_restaurant.id = membership.restaurant_id
                  AND active_restaurant.is_active
              )
          )
        )
      $policy$;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname = 'sehir_product_images_admin_delete'
    ) THEN
      EXECUTE $policy$
        CREATE POLICY "sehir_product_images_admin_delete"
        ON "storage"."objects"
        FOR DELETE
        TO authenticated
        USING (
          bucket_id = 'product-images'
          AND EXISTS (
            SELECT 1 FROM public.staff_profiles AS membership
            WHERE membership.auth_user_id = (SELECT auth.uid())
              AND membership.role IN ('ADMIN', 'MANAGER')
              AND membership.is_active AND membership.deleted_at IS NULL
              AND (storage.foldername(storage.objects.name))[1] = membership.restaurant_id::text
              AND EXISTS (
                SELECT 1 FROM public.restaurants AS active_restaurant
                WHERE active_restaurant.id = membership.restaurant_id
                  AND active_restaurant.is_active
              )
          )
        )
      $policy$;
    END IF;
  END IF;
END
$migration$;
