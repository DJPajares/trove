-- CreateEnum
CREATE TYPE "trove"."profile_distance_unit" AS ENUM ('km', 'mi');

-- CreateEnum
CREATE TYPE "trove"."profile_temperature_unit" AS ENUM ('celsius', 'fahrenheit');

-- CreateEnum
CREATE TYPE "trove"."profile_time_format" AS ENUM ('12h', '24h');

-- CreateEnum
CREATE TYPE "trove"."profile_date_format" AS ENUM ('mdy', 'dmy', 'ymd');

-- CreateEnum
CREATE TYPE "trove"."profile_appearance" AS ENUM ('system', 'light', 'dark');

-- AlterTable
ALTER TABLE "trove"."profiles"
ADD COLUMN "distance_unit" "trove"."profile_distance_unit",
ADD COLUMN "temperature_unit" "trove"."profile_temperature_unit",
ADD COLUMN "time_format" "trove"."profile_time_format",
ADD COLUMN "date_format" "trove"."profile_date_format",
ADD COLUMN "appearance" "trove"."profile_appearance";
