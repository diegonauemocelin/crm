-- Chat WhatsApp: foto do perfil de contatos e grupos (arquivo guardado no CRM) e quando foi conferida.

-- AlterTable
ALTER TABLE "whatsapp_conversations" ADD COLUMN     "photoCheckedAt" TIMESTAMP(3),
ADD COLUMN     "photoFileId" UUID;
