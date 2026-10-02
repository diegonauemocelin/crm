# Container de backup: mesma versão do cliente do Postgres do banco + age para criptografia.
FROM postgres:18-alpine
RUN apk add --no-cache age tini
COPY --chmod=755 backup.sh /usr/local/bin/backup.sh
COPY --chmod=755 agendador.sh /usr/local/bin/agendador.sh
USER postgres
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/usr/local/bin/agendador.sh"]
